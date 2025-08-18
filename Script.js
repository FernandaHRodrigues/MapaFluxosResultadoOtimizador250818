// Versão Definitiva - Correção dos filtros e leitura de arquivos - 18/08/2025
document.addEventListener('DOMContentLoaded', () => {
    // --- 1. Seleção de todos os elementos do DOM ---
    const flowsFileInput = document.getElementById('flows-file');
    const locationsFileInput = document.getElementById('locations-file');
    const lanesFileInput = document.getElementById('lanes-file');
    const runButton = document.getElementById('run-button');
    const highlightsButton = document.getElementById('highlights-button');
    const highlightsPanel = document.getElementById('highlights-panel');
    const closeHighlightsButton = document.getElementById('close-highlights');
    const highlightsContentBody = document.getElementById('highlights-content-body');
    const statusDiv = document.getElementById('status');
    const filtersContainer = document.getElementById('filters-container');
    const productFilterContainer = document.getElementById('product-filter-container');
    const vizControls = document.querySelector('.visualization-controls');
    const thicknessSlider = document.getElementById('thickness-slider');
    const markerRadiusSlider = document.getElementById('marker-radius-slider');
    
    // --- 2. Variáveis de Estado Global ---
    let flowsData = null, locationsData = null, lanesData = null;
    let allPolylines = [], allMarkers = {}, locationCoords = {}, layerGroups = {}, locationInfo = {};
    let finalFlowsForAnalysis = [];
    let markersLayer = L.layerGroup();
    const map = L.map('map').setView([-14.2350, -51.9253], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.addLayer(markersLayer);

    // --- 3. Paletas de Cores e Configurações ---
    const transportModeColorMap = { "RODO": "#007bff", "MARITIMO": "#17a2b8", "FERRO": "#28a745", "Default": "#6c757d" };
    const markerColorMap = { "Proprio": "#0072ce", "Transporte": "#414141", "Cliente": "#FF3700", "Terceiro": "#D8D8D8", "Default": "#151515" };

    // --- 4. Definição de TODAS as Funções ---

    const updateRunButtonStatus = () => {
        if (flowsData && locationsData && lanesData) {
            runButton.disabled = false;
            statusDiv.textContent = 'Arquivos prontos. Clique em "Gerar Mapa".';
        }
    };
    
    // Funções de leitura de arquivo separadas para CSV e XLSX
    const readXlsxFile = (file) => {
        return new Promise((resolve, reject) => {
            if (!file) return reject("Nenhum arquivo fornecido.");
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
                    resolve(jsonData);
                } catch (err) { reject(err); }
            };
            reader.onerror = (err) => reject(err);
            reader.readAsArrayBuffer(file);
        });
    };

    const readCsvFile = (file) => {
        return new Promise((resolve, reject) => {
            if (!file) return reject("Nenhum arquivo fornecido.");
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                delimiter: ';',
                complete: (results) => resolve(results.data),
                error: (err) => reject(err)
            });
        });
    };

    // Funções para lidar com o carregamento de cada arquivo
    const handleFlowsFile = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        statusDiv.textContent = 'Lendo arquivo de fluxos (CSV)...';
        try {
            flowsData = await readCsvFile(file);
            locationsFileInput.disabled = false;
            statusDiv.textContent = 'Fluxos carregados. Carregue o arquivo de localizações.';
            updateRunButtonStatus();
        } catch (error) {
            statusDiv.textContent = 'Erro ao ler arquivo de fluxos. Verifique o formato.';
            flowsData = null;
        }
    };

    const handleLocationsFile = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        statusDiv.textContent = 'Lendo arquivo de localizações (XLSX)...';
        try {
            locationsData = await readXlsxFile(file);
            lanesFileInput.disabled = false;
            statusDiv.textContent = 'Localizações carregadas. Carregue o arquivo de trechos.';
            updateRunButtonStatus();
        } catch (error) {
            statusDiv.textContent = 'Erro ao ler arquivo de localizações. Verifique o formato.';
            locationsData = null;
        }
    };
    
    const handleLanesFile = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        statusDiv.textContent = 'Lendo arquivo de trechos (XLSX)...';
        try {
            lanesData = await readXlsxFile(file);
            statusDiv.textContent = 'Todos os arquivos carregados.';
            updateRunButtonStatus();
        } catch (error) {
            statusDiv.textContent = 'Erro ao ler arquivo de trechos. Verifique o formato.';
            lanesData = null;
        }
    };

    // Função principal que processa os dados e desenha o mapa
    const processDataAndCreateLayers = () => {
        if (!flowsData || !locationsData || !lanesData) {
            statusDiv.textContent = 'Erro: Nem todos os arquivos foram carregados corretamente.';
            return;
        }
        runButton.disabled = true;
        highlightsButton.disabled = true;

        setTimeout(() => {
            statusDiv.textContent = 'Passo 1/5: Agregando dados...';
            const aggregated = flowsData
                .filter(row => String(row.triggeringEvent).trim().toLowerCase() === 'verdadeiro')
                .reduce((acc, row) => {
                    const originId = String(row['triggeringEventOriginLocationId']).trim();
                    const destinationId = String(row['triggeringEventDestinationLocationId']).trim();
                    const key = `${originId}->${destinationId}`;
                    if (!acc[key]) acc[key] = { origin: originId, destination: destinationId, volume: 0, materials: {} };
                    
                    const quantity = parseFloat(String(row['triggeringEventQuantity']).replace(',', '.')) || 0;
                    const material = String(row['referenceMaterialId']).trim() || 'Desconhecido';
                    
                    acc[key].volume += quantity;
                    if (!acc[key].materials[material]) acc[key].materials[material] = 0;
                    acc[key].materials[material] += quantity;
                    return acc;
            }, {});
            finalFlowsForAnalysis = Object.values(aggregated);
            
            statusDiv.textContent = 'Passo 2/5: Processando localizações e trechos...';
            const transportModeMap = lanesData.reduce((acc, row) => {
                const origin = String(row['Origin Location Id']).trim();
                const dest = String(row['Destination Location Id']).trim();
                if (origin && dest) acc[`${origin}->${dest}`] = String(row['Trecho']).trim();
                return acc;
            }, {});
            locationInfo = locationsData.reduce((acc, row) => {
                const locId = String(row['Location Id']).trim();
                if (locId) acc[locId] = { lat: row['Latitude'], lon: row['Longitude'], city: row['City'], state: row['State'] };
                return acc;
            }, {});
            locationCoords = Object.entries(locationInfo).reduce((acc, [id, details]) => {
                if (details.lat != null && details.lon != null) acc[id] = [parseFloat(details.lat), parseFloat(details.lon)];
                return acc;
            }, {});
            
            statusDiv.textContent = 'Passo 3/5: Criando objetos do mapa...';
            allPolylines = [];
            allMarkers = {};
            const uniqueModes = new Set();
            const uniqueProducts = new Set();
            
            finalFlowsForAnalysis.forEach(flow => {
                Object.keys(flow.materials).forEach(material => {
                    if (material !== 'Desconhecido') uniqueProducts.add(material);
                });

                const originCoords = locationCoords[flow.origin];
                const destCoords = locationCoords[flow.destination];
                if (originCoords && destCoords) {
                    const transportMode = transportModeMap[`${flow.origin}->${flow.destination}`] || "Default";
                    uniqueModes.add(transportMode);
                    const color = transportModeColorMap[transportMode] || transportModeColorMap["Default"];
                    const polyline = L.polyline([originCoords, destCoords], { color, opacity: 0.7 });
                    
                    const origin = flow.origin.toUpperCase();
                    const dest = flow.destination.toUpperCase();
                    let marketType = (origin.includes('BRA') && dest.includes('BRA')) ? 'mi' : 'me';

                    polyline.flowData = { ...flow, transportMode, market: marketType };
                    allPolylines.push(polyline);
                }
            });
            
            const allLocations = [...new Set(finalFlowsForAnalysis.flatMap(f => [f.origin, f.destination]))];
            allLocations.forEach(locId => {
                if (locationCoords[locId]) {
                    const group = getLocationGroup(locId);
                    const color = markerColorMap[group] || markerColorMap["Default"];
                    const circleMarker = L.circleMarker(locationCoords[locId], { fillColor: color, color: "#000", weight: 1.5, opacity: 1, fillOpacity: 0.9, radius: 8 });
                    circleMarker.locationId = locId;
                    // circleMarker.on('click', onMarkerClick); // O onMarkerClick será adicionado depois se necessário
                    allMarkers[locId] = circleMarker;
                }
            });

            statusDiv.textContent = 'Passo 4/5: Configurando filtros...';
            setupModeFilters(Array.from(uniqueModes));
            setupProductFilters(Array.from(uniqueProducts));
            
            statusDiv.textContent = 'Passo 5/5: Desenhando mapa...';
            vizControls.style.display = 'block'; // Mostra os controles de filtro
            updateMapView();
            runButton.disabled = false;
            highlightsButton.disabled = false;
        }, 10);
    };

    // Função que atualiza a visualização do mapa com base nos filtros
    const updateMapView = () => {
        statusDiv.textContent = 'Atualizando visualização...';
        const geoFilter = document.querySelector('input[name="geo-filter"]:checked').value;
        const thicknessMultiplier = parseFloat(thicknessSlider.value);
        const markerRadius = parseFloat(markerRadiusSlider.value);

        const selectedProductsCheckboxes = productFilterContainer.querySelectorAll('input[name="product"]:checked');
        const selectedProducts = Array.from(selectedProductsCheckboxes).map(cb => cb.value);
        const selectAllProducts = selectedProducts.includes('all');

        Object.values(layerGroups).forEach(group => group.clearLayers());

        const visiblePolylines = allPolylines.filter(p => {
            const marketMatch = (geoFilter === 'all') || (p.flowData.market === geoFilter);
            
            let productMatch = false;
            if (selectAllProducts) {
                productMatch = true;
            } else if (selectedProducts.length > 0 && p.flowData.materials) {
                productMatch = selectedProducts.some(product => p.flowData.materials[product]);
            } else if (selectedProducts.length === 0) {
                productMatch = false; 
            }
            return marketMatch && productMatch;
        });

        if (visiblePolylines.length === 0) {
            statusDiv.textContent = "Nenhum fluxo visível para os filtros selecionados.";
        } else {
            const volumes = visiblePolylines.map(p => p.flowData.volume).filter(v => v > 0);
            const minVolume = Math.min(...volumes);
            const maxVolume = Math.max(...volumes);

            visiblePolylines.forEach(p => {
                let weight = 3;
                if (maxVolume > minVolume) {
                    const normalizedVolume = (p.flowData.volume - minVolume) / (maxVolume - minVolume);
                    weight = 2 + (normalizedVolume * 15 * thicknessMultiplier);
                }
                p.setStyle({ weight });
                if (layerGroups[p.flowData.transportMode]) {
                    layerGroups[p.flowData.transportMode].addLayer(p);
                }
            });
            statusDiv.textContent = `Visualização atualizada. ${visiblePolylines.length} fluxos exibidos.`;
        }
        
        markersLayer.clearLayers();
        Object.values(allMarkers).forEach(marker => {
            marker.setRadius(markerRadius);
            markersLayer.addLayer(marker);
        });

        const modeCheckboxes = filtersContainer.querySelectorAll('input[type="checkbox"]');
        modeCheckboxes.forEach(cb => {
            if (cb.checked && layerGroups[cb.name]) {
                map.addLayer(layerGroups[cb.name]);
            } else if (!cb.checked && layerGroups[cb.name]) {
                map.removeLayer(layerGroups[cb.name]);
            }
        });
    };
    
    // Função que cria os checkboxes para os produtos
    const setupProductFilters = (products) => {
        productFilterContainer.innerHTML = '';
        
        const allDiv = document.createElement('div');
        allDiv.innerHTML = `<label style="font-weight: bold;"><input type="checkbox" name="product" value="all" checked> Selecionar Todos</label>`;
        productFilterContainer.appendChild(allDiv);

        const allCheckbox = allDiv.querySelector('input');
        const productCheckboxes = [];

        products.sort().forEach(product => {
            const productDiv = document.createElement('div');
            productDiv.innerHTML = `<label><input type="checkbox" name="product" value="${product}" checked> ${product}</label>`;
            const checkbox = productDiv.querySelector('input');
            productCheckboxes.push(checkbox);
            
            checkbox.addEventListener('change', () => {
                allCheckbox.checked = productCheckboxes.every(cb => cb.checked);
                updateMapView();
            });
            productFilterContainer.appendChild(productDiv);
        });

        allCheckbox.addEventListener('change', () => {
            productCheckboxes.forEach(cb => {
                cb.checked = allCheckbox.checked;
            });
            updateMapView();
        });
    };
    
    // Função que cria os checkboxes para os modos de transporte
    const setupModeFilters = (modes) => {
        filtersContainer.innerHTML = '';
        layerGroups = {};
        modes.sort().forEach(mode => {
            layerGroups[mode] = L.layerGroup();
            const color = transportModeColorMap[mode] || transportModeColorMap["Default"];
            const filterDiv = document.createElement('div');
            filterDiv.innerHTML = `<label><input type="checkbox" name="${mode}" checked> <span class="color-box" style="background-color:${color};"></span> ${mode}</label>`;
            const checkbox = filterDiv.querySelector('input');
            checkbox.addEventListener('change', updateMapView);
            filtersContainer.appendChild(filterDiv);
        });
    };

    // Funções de highlights, clique no marcador, etc (placeholders)
    const calculateAndShowHighlights = () => { /* Sua lógica de highlights aqui */ };
    const onMarkerClick = () => { /* Sua lógica de clique no marcador aqui */ };
    const getLocationGroup = (locationId) => {
        const id = locationId.toUpperCase();
        if (id.includes('CLIENTE') || id.includes('CLI')) return 'Cliente';
        if (id.includes('TERCEIRO') || id.includes('TER')) return 'Terceiro';
        if (id.startsWith('USI') || id.includes('USINA') || id.includes('PROP')) return 'Proprio';
        return "Default";
    };

    // --- 5. Vinculação Final dos Eventos ---
    flowsFileInput.addEventListener('change', handleFlowsFile);
    locationsFileInput.addEventListener('change', handleLocationsFile);
    lanesFileInput.addEventListener('change', handleLanesFile);
    runButton.addEventListener('click', processDataAndCreateLayers);
    highlightsButton.addEventListener('click', () => highlightsPanel.classList.toggle('visible'));
    closeHighlightsButton.addEventListener('click', () => highlightsPanel.classList.remove('visible'));
    document.querySelectorAll('input[name="geo-filter"]').forEach(radio => radio.addEventListener('change', updateMapView));
    thicknessSlider.addEventListener('input', updateMapView);
    markerRadiusSlider.addEventListener('input', updateMapView);
});