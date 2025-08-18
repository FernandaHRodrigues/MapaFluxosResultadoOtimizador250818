// Versão Final com Filtro de Produto - 18/08/2025
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
    const vizControls = document.querySelector('.visualization-controls');
    const thicknessSlider = document.getElementById('thickness-slider');
    const markerRadiusSlider = document.getElementById('marker-radius-slider');
    const productFilterSelect = document.getElementById('product-filter'); // Novo seletor

    // --- 2. Variáveis de Estado Global ---
    let flowsData = null, locationsData = null, lanesData = null;
    let allPolylines = [], allMarkers = {}, locationCoords = {}, layerGroups = {}, locationInfo = {};
    let finalFlowsForHighlights = [];
    let markersLayer = L.layerGroup();
    const map = L.map('map').setView([-14.2350, -51.9253], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    map.addLayer(markersLayer);

    // --- 3. Paletas de Cores ---
    const transportModeColorMap = { "RODO": "#007bff", "MARITIMO": "#17a2b8", "FERRO": "#28a745", "Default": "#6c757d" };
    const markerColorMap = { "Proprio": "#0072ce", "Transporte": "#414141", "Cliente": "#FF3700", "Terceiro": "#D8D8D8", "Default": "#151515" };

    // --- 4. Definição de TODAS as Funções ---

    function updateRunButtonStatus() {
        if (flowsData && locationsData && lanesData) {
            runButton.disabled = false;
            statusDiv.textContent = 'Arquivos prontos. Clique em "Gerar Mapa".';
        }
    }
    
    function readFile(file, type) {
        return new Promise((resolve, reject) => {
            if (!file) return reject("Nenhum arquivo fornecido.");

            if (type === 'xlsx') {
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
            } else {
                Papa.parse(file, {
                    header: true,
                    skipEmptyLines: true,
                    delimiter: type === 'csv_flows' ? ';' : ',',
                    complete: (results) => resolve(results.data),
                    error: (err) => reject(err)
                });
            }
        });
    }

    async function handleFlowsFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        statusDiv.textContent = 'Lendo arquivo de fluxos (CSV)...';
        try {
            flowsData = await readFile(file, 'csv_flows');
            locationsFileInput.disabled = false;
            statusDiv.textContent = "Fluxos carregados. Selecione o arquivo de localizações.";
            updateRunButtonStatus();
        } catch(error) {
            statusDiv.textContent = 'Erro ao ler arquivo. Verifique o formato.';
            flowsData = null;
        }
    }

    async function handleLocationsFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        statusDiv.textContent = "Lendo arquivo de localizações (XLSX)...";
        try {
            locationsData = await readFile(file, 'xlsx');
            lanesFileInput.disabled = false;
            statusDiv.textContent = "Localizações carregadas. Selecione o arquivo de trechos.";
            updateRunButtonStatus();
        } catch(error) {
            statusDiv.textContent = 'Erro ao ler arquivo. Verifique o formato.';
            locationsData = null;
        }
    }
    
    async function handleLanesFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        statusDiv.textContent = 'Lendo arquivo de trechos (XLSX)...';
        try {
            lanesData = await readFile(file, 'xlsx');
            statusDiv.textContent = "Arquivo de trechos carregado.";
            updateRunButtonStatus();
        } catch(error) {
            statusDiv.textContent = 'Erro ao ler arquivo. Verifique o formato.';
            lanesData = null;
        }
    }

    function processDataAndCreateLayers() {
        if (!flowsData || !locationsData || !lanesData) {
            statusDiv.textContent = 'Erro: Nem todos os arquivos foram carregados corretamente.';
            return;
        }
        runButton.disabled = true;
        highlightsButton.disabled = true;

        setTimeout(() => {
            statusDiv.textContent = 'Passo 1/5: Filtrando e limpando dados...';
            const filteredFlows = flowsData.filter(row => 
                String(row.triggeringEvent).trim().toLowerCase() === 'verdadeiro' && 
                row.triggeringEventOriginLocationId && 
                row.triggeringEventDestinationLocationId
            );

            statusDiv.textContent = 'Passo 2/5: Agregando dados...';
            const aggregated = filteredFlows.reduce((acc, row) => {
                const originId = String(row.triggeringEventOriginLocationId).trim();
                const destinationId = String(row.triggeringEventDestinationLocationId).trim();
                const key = `${originId}->${destinationId}`;
                if (!acc[key]) { acc[key] = { origin: originId, destination: destinationId, volume: 0, totalValue: 0, materials: {} }; }
                const quantity = parseFloat(String(row.triggeringEventQuantity).replace(',', '.')) || 0;
                acc[key].volume += quantity;
                acc[key].totalValue += parseFloat(String(row.triggeringEventValue).replace(',', '.')) || 0;
                const material = String(row.referenceMaterialId).trim() || 'Desconhecido';
                if (!acc[key].materials[material]) acc[key].materials[material] = 0;
                acc[key].materials[material] += quantity;
                return acc;
            }, {});
            const finalFlows = Object.values(aggregated);
            finalFlowsForHighlights = finalFlows;

            // --- INÍCIO DA MODIFICAÇÃO: Coleta de produtos únicos ---
            const uniqueProducts = new Set();
            finalFlows.forEach(flow => {
                Object.keys(flow.materials).forEach(material => {
                    if (material !== 'Desconhecido') {
                        uniqueProducts.add(material);
                    }
                });
            });
            setupProductFilters(Array.from(uniqueProducts));
            // --- FIM DA MODIFICAÇÃO ---


            statusDiv.textContent = 'Passo 3/5: Processando localizações e trechos...';
            const transportModeMap = lanesData.reduce((acc, row) => {
                const origin = String(row['Origin Location Id']).trim();
                const dest = String(row['Destination Location Id']).trim();
                if (origin && dest) acc[`${origin}->${dest}`] = row.Trecho;
                return acc;
            }, {});
            locationInfo = locationsData.reduce((acc, row) => {
                const locId = String(row['Location Id']).trim();
                if (locId) acc[locId] = { lat: row.Latitude, lon: row.Longitude, city: row.City, country: row.Country, state: String(row.State).trim() };
                return acc;
            }, {});
            locationCoords = Object.entries(locationInfo).reduce((acc, [id, details]) => {
                if (details.lat != null && details.lon != null) acc[id] = [parseFloat(details.lat), parseFloat(details.lon)];
                return acc;
            }, {});

            statusDiv.textContent = 'Passo 4/5: Criando objetos do mapa...';
            allPolylines = []; allMarkers = {}; const uniqueModes = new Set();
            finalFlows.forEach(flow => {
                const originCoords = locationCoords[flow.origin]; const destCoords = locationCoords[flow.destination];
                if (originCoords && destCoords) {
                    const transportMode = transportModeMap[`${flow.origin}->${flow.destination}`] || "Default";
                    const color = transportModeColorMap[transportMode] || transportModeColorMap["Default"];
                    const polyline = L.polyline([originCoords, destCoords], { color, opacity: 0.7 });
                    const origin = flow.origin.toUpperCase(); const dest = flow.destination.toUpperCase();
                    let marketType = 'me';
                    if ((origin.includes('BRA') || origin.includes('MI')) && (dest.includes('BRA') || dest.includes('MI'))) { marketType = 'mi'; }
                    polyline.flowData = flow;
                    polyline.flowData.transportMode = transportMode;
                    polyline.flowData.market = marketType;
                    allPolylines.push(polyline);
                    uniqueModes.add(transportMode);
                }
            });
            const uniqueLocations = [...new Set(finalFlows.flatMap(f => [f.origin, f.destination]))];
            uniqueLocations.forEach(locId => {
                if (locationCoords[locId]) {
                    const group = getLocationGroup(locId); const color = markerColorMap[group] || markerColorMap["Default"];
                    const circleMarker = L.circleMarker(locationCoords[locId], { fillColor: color, color: "#000", weight: 1, opacity: 1, fillOpacity: 0.8 });
                    circleMarker.locationId = locId;
                    circleMarker.on('click', onMarkerClick);
                    allMarkers[locId] = circleMarker;
                }
            });
            
            Object.values(layerGroups).forEach(group => map.removeLayer(group));
            layerGroups = {};
            uniqueModes.forEach(mode => { layerGroups[mode] = L.layerGroup(); });

            statusDiv.textContent = 'Passo 5/5: Desenhando mapa...';
            setupModeFilters(uniqueModes);
            updateMapView();
            runButton.disabled = false;
            highlightsButton.disabled = false;
        }, 10);
    }
    
    function updateMapView() {
        statusDiv.textContent = 'Atualizando visualização...';
        const geoFilter = document.querySelector('input[name="geo-filter"]:checked').value;
        const selectedProduct = productFilterSelect.value; // Pega o produto selecionado
        const thicknessMultiplier = parseFloat(thicknessSlider.value);
        const markerRadius = parseFloat(markerRadiusSlider.value);
        
        Object.values(layerGroups).forEach(group => group.clearLayers());
        markersLayer.clearLayers();

        vizControls.style.display = 'block';
        
        // --- INÍCIO DA MODIFICAÇÃO: Aplica o filtro de produto ---
        const visiblePolylines = allPolylines.filter(p => {
            const marketMatch = (geoFilter === 'all') || (p.flowData.market === geoFilter);
            const productMatch = (selectedProduct === 'all') || (p.flowData.materials && p.flowData.materials[selectedProduct]);
            return marketMatch && productMatch;
        });
        // --- FIM DA MODIFICAÇÃO ---

        const volumes = visiblePolylines.map(p => p.flowData.volume).filter(v => v > 0);
        if (volumes.length === 0) {
            statusDiv.textContent = "Nenhum fluxo visível para os filtros selecionados.";
            // Limpa o mapa se não houver fluxos
            Object.values(layerGroups).forEach(group => map.removeLayer(group));
            markersLayer.clearLayers();
            return;
        }
        
        const minVolume = Math.min(...volumes); const maxVolume = Math.max(...volumes);
        
        visiblePolylines.forEach(p => {
            let weight = 2; 
            if (maxVolume > minVolume) { 
                const normalizedVolume = (p.flowData.volume - minVolume) / (maxVolume - minVolume); 
                weight = 2 + (normalizedVolume * 15 * thicknessMultiplier); 
            }
            p.setStyle({ weight });
            const flow = p.flowData; 
            const formattedVolume = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(flow.volume);
            const sortedMaterials = Object.entries(flow.materials).sort(([,a],[,b]) => b - a);
            let materialsHTML = '<ul style="margin: 5px 0 0 0; padding-left: 20px; max-height: 100px; overflow-y: auto;">';
            if(sortedMaterials.length > 0){
                sortedMaterials.forEach(([name, vol]) => { materialsHTML += `<li>${name}: ${new Intl.NumberFormat('pt-BR').format(vol)}</li>`; });
            } else {
                materialsHTML += '<li>Nenhum material detalhado.</li>';
            }
            materialsHTML += '</ul>';
            
            const popupContent = `<b>Modo:</b> ${flow.transportMode}<br><b>De:</b> ${flow.origin}<br><b>Para:</b> ${flow.destination}<br><b>Volume Total:</b> ${formattedVolume}<br><b>Materiais:</b>${materialsHTML}`;
            p.bindPopup(popupContent);
            
            if (layerGroups[flow.transportMode]) {
                layerGroups[flow.transportMode].addLayer(p);
            }
        });

        // Garante que todas as camadas sejam removidas antes de adicionar as visíveis
        Object.values(layerGroups).forEach(group => map.removeLayer(group));
        document.querySelectorAll('#filters-container input[type="checkbox"]').forEach(checkbox => {
            if (checkbox.checked && layerGroups[checkbox.name]) {
                map.addLayer(layerGroups[checkbox.name]);
            }
        });

        const visibleLocations = [...new Set(visiblePolylines.flatMap(p => [p.flowData.origin, p.flowData.destination]))];
        visibleLocations.forEach(locId => { 
            if (allMarkers[locId]) { 
                allMarkers[locId].setRadius(markerRadius); 
                markersLayer.addLayer(allMarkers[locId]); 
            } 
        });

        statusDiv.textContent = `Visualização atualizada. ${visiblePolylines.length} fluxos exibidos.`;
    }

    function calculateAndShowHighlights() {
        if (!finalFlowsForHighlights || finalFlowsForHighlights.length === 0) {
            highlightsContentBody.innerHTML = '<p>Não há dados de fluxo para calcular os destaques.</p>';
            highlightsPanel.classList.add('visible');
            return;
        }
        const locationCapacities = {'POR-BRA-ES-PMO': 5500000, 'POR-BRA-ES-TBO': 500000, 'POR-BRA-ES-TODOS': 5500000, 'POR-BRA-ES-TPS': 5500000, 'POR-BRA-SC-ITJ': 160000, 'POR-BRA-SC-SFS': 2800000, 'TFE-BRA-ES-AMT': 500000, 'USI-BRA-CE-PEC-AMP': 3000000, 'USI-BRA-ES-SER-AMT': 7200000};
        const locationThroughput = {};
        finalFlowsForHighlights.forEach(flow => {
            if (!locationThroughput[flow.origin]) locationThroughput[flow.origin] = 0;
            locationThroughput[flow.origin] += flow.volume;
            if (!locationThroughput[flow.destination]) locationThroughput[flow.destination] = 0;
            locationThroughput[flow.destination] += flow.volume;
        });
        const capacityAnalysis = [];
        for (const locationId in locationThroughput) {
            const throughput = locationThroughput[locationId];
            const capacity = locationCapacities[locationId];
            let percentage = 0;
            if (capacity && capacity > 0) {
                percentage = (throughput / capacity) * 100;
            }
            capacityAnalysis.push({id: locationId, throughput: throughput, percentage: percentage});
        }
        capacityAnalysis.sort((a, b) => b.percentage - a.percentage);
        let highlightsHTML = '<h4>Análise de Capacidade por Localização</h4>';
        if (capacityAnalysis.length > 0) {
            highlightsHTML += '<ul>';
            capacityAnalysis.forEach(item => {
                const throughputFormatted = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(item.throughput);
                const percentageFormatted = item.percentage > 0 ? `<b>(${item.percentage.toFixed(2)}%)</b>` : '';
                highlightsHTML += `<li><b>${item.id}:</b> ${throughputFormatted} TON ${percentageFormatted}</li>`;
            });
            highlightsHTML += '</ul>';
        } else {
            highlightsHTML += '<p>Nenhum dado de movimentação encontrado.</p>';
        }
        highlightsContentBody.innerHTML = highlightsHTML;
        highlightsPanel.classList.add('visible');
    }

    function getLocationGroup(locationId) {
        const id = locationId.toUpperCase();
        if (id.includes('CLIENTE') || id.includes('CLI')) return 'Cliente';
        if (id.includes('TERCEIRO') || id.includes('TER')) return 'Terceiro';
        if (id.startsWith('USI') || id.includes('USINA') || id.includes('PROP')) return 'Proprio';
        return "Default";
    }

    function onMarkerClick(e) {
        const clickedLocationId = e.target.locationId;
        const outgoing = {};
        const incoming = {};
        let totalOutgoingVolume = 0;
        let totalIncomingVolume = 0;
        finalFlowsForHighlights.forEach(flow => {
            if (flow.origin === clickedLocationId) {
                totalOutgoingVolume += flow.volume;
                if (!outgoing[flow.destination]) { outgoing[flow.destination] = {}; }
                for (const material in flow.materials) {
                    if (!outgoing[flow.destination][material]) { outgoing[flow.destination][material] = 0; }
                    outgoing[flow.destination][material] += flow.materials[material];
                }
            }
            if (flow.destination === clickedLocationId) {
                totalIncomingVolume += flow.volume;
                if (!incoming[flow.origin]) { incoming[flow.origin] = {}; }
                for (const material in flow.materials) {
                    if (!incoming[flow.origin][material]) { incoming[flow.origin][material] = 0; }
                    incoming[flow.origin][material] += flow.materials[material];
                }
            }
        });
        let popupContent = `<div class="location-popup"><b>Resumo de ${clickedLocationId}</b><br>`;
        popupContent += `<b style="color: #c0392b;">Total Saídas:</b> ${new Intl.NumberFormat('pt-BR').format(totalOutgoingVolume.toFixed(2))}<br>`;
        popupContent += `<b style="color: #27ae60;">Total Entradas:</b> ${new Intl.NumberFormat('pt-BR').format(totalIncomingVolume.toFixed(2))}`;
        popupContent += '<h4>SAÍDAS</h4>';
        if (Object.keys(outgoing).length > 0) {
            popupContent += '<ul>';
            for (const dest in outgoing) {
                popupContent += `<li>Para <b>${dest}</b>:`;
                popupContent += '<ul>';
                for (const mat in outgoing[dest]) {
                    popupContent += `<li>${mat}: ${new Intl.NumberFormat('pt-BR').format(outgoing[dest][mat].toFixed(2))}</li>`;
                }
                popupContent += '</ul></li>';
            }
            popupContent += '</ul>';
        } else {
            popupContent += '<p>Nenhum fluxo de saída registrado.</p>';
        }
        popupContent += '<h4>ENTRADAS</h4>';
        if (Object.keys(incoming).length > 0) {
            popupContent += '<ul>';
            for (const origin in incoming) {
                popupContent += `<li>De <b>${origin}</b>:`;
                popupContent += '<ul>';
                for (const mat in incoming[origin]) {
                    popupContent += `<li>${mat}: ${new Intl.NumberFormat('pt-BR').format(incoming[origin][mat].toFixed(2))}</li>`;
                }
                popupContent += '</ul></li>';
            }
            popupContent += '</ul>';
        } else {
            popupContent += '<p>Nenhum fluxo de entrada registrado.</p>';
        }
        popupContent += '</div>';
        L.popup().setLatLng(e.latlng).setContent(popupContent).openOn(map);
    }
    
    // --- INÍCIO DE NOVA FUNÇÃO: Cria o filtro de produtos ---
    function setupProductFilters(products) {
        productFilterSelect.innerHTML = '<option value="all">Todos os Produtos</option>'; // Reseta o filtro
        products.sort(); // Ordena os produtos alfabeticamente
        products.forEach(product => {
            const option = document.createElement('option');
            option.value = product;
            option.textContent = product;
            productFilterSelect.appendChild(option);
        });
        productFilterSelect.disabled = false; // Habilita o filtro
    }
    // --- FIM DE NOVA FUNÇÃO ---

    function setupModeFilters(uniqueModes) {
        filtersContainer.innerHTML = '';
        const allModes = Array.from(uniqueModes);
        allModes.sort();
        
        allModes.forEach(mode => {
            const color = transportModeColorMap[mode] || transportModeColorMap["Default"];
            const filterDiv = document.createElement('div');
            filterDiv.innerHTML = `
                <label>
                    <input type="checkbox" name="${mode}" checked>
                    <span class="color-box" style="background-color: ${color};"></span>
                    ${mode}
                </label>`;
            const checkbox = filterDiv.querySelector('input');
            checkbox.addEventListener('change', () => {
                // Ao mudar o filtro de modo, a visualização principal é chamada
                updateMapView();
            });
            filtersContainer.appendChild(filterDiv);
        });
    }

    // --- 5. Vinculação Final dos Eventos ---
    flowsFileInput.addEventListener('change', handleFlowsFile);
    locationsFileInput.addEventListener('change', handleLocationsFile);
    lanesFileInput.addEventListener('change', handleLanesFile);
    runButton.addEventListener('click', processDataAndCreateLayers);
    highlightsButton.addEventListener('click', calculateAndShowHighlights);
    closeHighlightsButton.addEventListener('click', () => highlightsPanel.classList.remove('visible'));
    document.querySelectorAll('input[name="geo-filter"]').forEach(radio => radio.addEventListener('change', updateMapView));
    
    // Adiciona o evento para o novo filtro de produto
    productFilterSelect.addEventListener('change', updateMapView);

    thicknessSlider.addEventListener('input', updateMapView);
    markerRadiusSlider.addEventListener('input', updateMapView);
});