// Versão 14/10/2025
document.addEventListener('DOMContentLoaded', () => {
    // --- 1. Seleção de todos os elementos do DOM ---
    const flowsFileInput = document.getElementById('flows-file');
    const locationsFileInput = document.getElementById('locations-file');
    const lanesFileInput = document.getElementById('lanes-file');
    const runButton = document.getElementById('run-button');
    const highlightsButton = document.getElementById('highlights-button');
    const co2Button = document.getElementById('co2-button'); // Botão CO2
    const highlightsPanel = document.getElementById('highlights-panel');
    const closeHighlightsButton = document.getElementById('close-highlights');
    const highlightsContentBody = document.getElementById('highlights-content-body');
    const statusDiv = document.getElementById('status');
    const filtersContainer = document.getElementById('filters-container');
    const productFilterContainer = document.getElementById('product-filter-container');
    const originFilterContainer = document.getElementById('origin-filter-container');
    const vizControls = document.querySelector('.visualization-controls');
    const thicknessSlider = document.getElementById('thickness-slider');
    const markerRadiusSlider = document.getElementById('marker-radius-slider');

    // --- Elementos do Modal de CO2 ---
    const co2Modal = document.getElementById('co2-modal');
    const closeCo2ModalButton = document.getElementById('close-co2-modal');
    const calculateCo2Button = document.getElementById('calculate-co2-button');
    
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

    // --- 4. Funções Principais ---

    const updateRunButtonStatus = () => {
        if (flowsData && locationsData && lanesData) {
            runButton.disabled = false;
            statusDiv.textContent = 'Arquivos prontos. Clique em "Gerar Mapa".';
        }
    };
    
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

    const processDataAndCreateLayers = () => {
        if (!flowsData || !locationsData || !lanesData) return;
        runButton.disabled = true; highlightsButton.disabled = true; co2Button.disabled = true;

        setTimeout(() => {
            statusDiv.textContent = 'Passo 1/5: Agregando dados...';
            const processedFlows = {};
            flowsData.filter(row => String(row.triggeringEvent).trim().toLowerCase() === 'verdadeiro')
                .forEach(row => {
                    const origin = String(row['triggeringEventOriginLocationId']).trim();
                    const destination = String(row['triggeringEventDestinationLocationId']).trim();
                    const material = String(row['referenceMaterialId']).trim() || 'Desconhecido';
                    const key = `${origin}->${destination}->${material}`;
                    const dreLine = String(row['dreLineType']).trim().toLowerCase();
                    const quantity = parseFloat(String(row['triggeringEventQuantity']).replace(',', '.')) || 0;
                    const value = parseFloat(String(row['triggeringEventValue']).replace(',', '.')) || 0;
                    if (!processedFlows[key]) {
                        processedFlows[key] = { origin, destination, material, quantity, baseValue: 0, discountValue: 0 };
                    }
                    if (dreLine.includes('cost')) processedFlows[key].baseValue += value;
                    else if (dreLine.includes('taxes')) processedFlows[key].discountValue += value;
                });
            
            const aggregatedByRoute = {};
            Object.values(processedFlows).forEach(flow => {
                const routeKey = `${flow.origin}->${flow.destination}`;
                if (!aggregatedByRoute[routeKey]) {
                    aggregatedByRoute[routeKey] = { origin: flow.origin, destination: flow.destination, volume: 0, totalBaseValue: 0, totalDiscountValue: 0, materials: {} };
                }
                const route = aggregatedByRoute[routeKey];
                route.volume += flow.quantity;
                route.totalBaseValue += flow.baseValue;
                route.totalDiscountValue += flow.discountValue;
                if (!route.materials[flow.material]) route.materials[flow.material] = 0;
                route.materials[flow.material] += flow.quantity;
            });
            
            statusDiv.textContent = 'Passo 2/5: Processando localizações e trechos...';
            const transportModeMap = lanesData.reduce((acc, row) => {
                const origin = String(row['Origin Location Id']).trim();
                const dest = String(row['Destination Location Id']).trim();
                if (origin && dest) {
                    acc[`${origin}->${dest}`] = {
                        mode: String(row['Trecho']).trim(),
                        distance: parseFloat(String(row['Distance (KM)']).replace(',', '.')) || 0
                    };
                }
                return acc;
            }, {});
            
            locationInfo = locationsData.reduce((acc, row) => { const id = String(row['Location Id']).trim(); if (id) acc[id] = { lat: row['Latitude'], lon: row['Longitude'], country: String(row['Country']).trim() }; return acc; }, {});
            locationCoords = Object.entries(locationInfo).reduce((acc, [id, details]) => { if (details.lat != null && details.lon != null) acc[id] = [parseFloat(details.lat), parseFloat(details.lon)]; return acc; }, {});

            finalFlowsForAnalysis = Object.values(aggregatedByRoute).map(flow => {
                const laneInfo = transportModeMap[`${flow.origin}->${flow.destination}`] || { mode: "Default", distance: 0 };
                return { ...flow, transportMode: laneInfo.mode, distance: laneInfo.distance };
            });
            
            statusDiv.textContent = 'Passo 3/5: Criando objetos do mapa...';
            allPolylines = []; allMarkers = {};
            const uniqueModes = new Set(), uniqueProducts = new Set(), uniqueOrigins = new Set();
            finalFlowsForAnalysis.forEach(flow => {
                uniqueOrigins.add(flow.origin);
                Object.keys(flow.materials).forEach(m => uniqueProducts.add(m));
                const originCoords = locationCoords[flow.origin], destCoords = locationCoords[flow.destination];
                if (originCoords && destCoords) {
                    const polyline = L.polyline([originCoords, destCoords], { color: transportModeColorMap[flow.transportMode] || transportModeColorMap["Default"], opacity: 0.7 });
                    const originCountry = locationInfo[flow.origin]?.country, destCountry = locationInfo[flow.destination]?.country;
                    polyline.flowData = { ...flow, market: (originCountry === 'Brasil' && destCountry === 'Brasil') ? 'mi' : 'me' };
                    allPolylines.push(polyline);
                    uniqueModes.add(flow.transportMode);
                }
            });
             [...new Set(finalFlowsForAnalysis.flatMap(f => [f.origin, f.destination]))].forEach(locId => {
                if (locationCoords[locId]) {
                    const marker = L.circleMarker(locationCoords[locId], { fillColor: markerColorMap[getLocationGroup(locId)] || markerColorMap["Default"], color: "#000", weight: 1.5, opacity: 1, fillOpacity: 0.9, radius: 8 });
                    marker.locationId = locId;
                    marker.on('click', onMarkerClick);
                    allMarkers[locId] = marker;
                }
            });

            statusDiv.textContent = 'Passo 4/5: Configurando filtros...';
            setupOriginFilter(Array.from(uniqueOrigins));
            setupModeFilters(Array.from(uniqueModes));
            setupProductFilters(Array.from(uniqueProducts));
            
            statusDiv.textContent = 'Passo 5/5: Desenhando mapa...';
            vizControls.style.display = 'block';
            updateMapView();
            runButton.disabled = false; highlightsButton.disabled = false; co2Button.disabled = false;
        }, 10);
    };

    const updateMapView = () => {
        statusDiv.textContent = 'Atualizando visualização...';
        const geoFilter = document.querySelector('input[name="geo-filter"]:checked').value;
        const thicknessMultiplier = parseFloat(thicknessSlider.value);
        const markerRadius = parseFloat(markerRadiusSlider.value);
        const selectedProducts = Array.from(productFilterContainer.querySelectorAll('input[name="product"]:checked')).map(cb => cb.value);
        const selectAllProducts = selectedProducts.includes('all');
        const selectedOrigins = Array.from(originFilterContainer.querySelectorAll('input[name="origin"]:checked')).map(cb => cb.value);
        const selectAllOrigins = selectedOrigins.includes('all');
        Object.values(layerGroups).forEach(group => group.clearLayers());
        const visiblePolylines = allPolylines.filter(p => {
            const marketMatch = (geoFilter === 'all') || (p.flowData.market === geoFilter);
            const originMatch = selectAllOrigins || selectedOrigins.includes(p.flowData.origin);
            let productMatch = selectAllProducts || (selectedProducts.length > 0 && selectedProducts.some(product => p.flowData.materials[product]));
            return marketMatch && productMatch && originMatch;
        });
        if (visiblePolylines.length === 0) {
            statusDiv.textContent = "Nenhum fluxo visível para os filtros selecionados.";
            Object.values(layerGroups).forEach(group => map.removeLayer(group));
        } else {
            const volumes = visiblePolylines.map(p => p.flowData.volume).filter(v => v > 0);
            const minVolume = Math.min(...volumes);
            const maxVolume = Math.max(...volumes);
            visiblePolylines.forEach(p => {
                let weight = 3;
                if (maxVolume > minVolume) weight = 2 + (((p.flowData.volume - minVolume) / (maxVolume - minVolume)) * 15 * thicknessMultiplier);
                p.setStyle({ weight });
                const flow = p.flowData;
                const finalValue = flow.totalBaseValue + flow.totalDiscountValue;
                const unitValue = flow.volume > 0 ? finalValue / flow.volume : 0;
                const materialsHTML = Object.entries(flow.materials).sort(([, a], [, b]) => b - a).map(([name, vol]) => `<li>${name}: ${new Intl.NumberFormat('pt-BR').format(vol.toFixed(2))}</li>`).join('');
                p.bindPopup(`<b>Modo:</b> ${flow.transportMode}<br><b>De:</b> ${flow.origin}<br><b>Para:</b> ${flow.destination}<hr><b>Volume Total:</b> ${new Intl.NumberFormat('pt-BR').format(flow.volume.toFixed(2))}<br><b>Valor Original (Custo):</b> ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(flow.totalBaseValue)}<br><b>Desconto (Taxas):</b> ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(flow.totalDiscountValue)}<br><b>Valor Final:</b> ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(finalValue)}<br><b>Valor Unitário:</b> ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(unitValue)}<hr><b>Materiais:</b><ul style="margin: 5px 0 0 0; padding-left: 20px; max-height: 100px; overflow-y: auto;">${materialsHTML}</ul>`);
                if (layerGroups[flow.transportMode]) layerGroups[flow.transportMode].addLayer(p);
            });
            statusDiv.textContent = `Visualização atualizada. ${visiblePolylines.length} fluxos exibidos.`;
        }
        markersLayer.clearLayers();
        Object.values(allMarkers).forEach(marker => { marker.setRadius(markerRadius); markersLayer.addLayer(marker); });
        document.querySelectorAll('#filters-container input[type="checkbox"]').forEach(cb => { 
            if (cb.checked && layerGroups[cb.name]) map.addLayer(layerGroups[cb.name]); 
            else if (!cb.checked && layerGroups[cb.name]) map.removeLayer(layerGroups[cb.name]); 
        });
    };
    
    const createCheckboxFilter = (container, items, name, onchange) => {
        container.innerHTML = '';
        const allDiv = document.createElement('div');
        allDiv.innerHTML = `<label style="font-weight: bold;"><input type="checkbox" name="${name}" value="all" checked> Selecionar Todos</label>`;
        container.appendChild(allDiv);
        const allCheckbox = allDiv.querySelector('input');
        const itemCheckboxes = [];
        items.sort().forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.innerHTML = `<label><input type="checkbox" name="${name}" value="${item}" checked> ${item}</label>`;
            const checkbox = itemDiv.querySelector('input');
            itemCheckboxes.push(checkbox);
            checkbox.addEventListener('change', () => {
                allCheckbox.checked = itemCheckboxes.every(cb => cb.checked);
                onchange();
            });
            container.appendChild(itemDiv);
        });
        allCheckbox.addEventListener('change', () => {
            itemCheckboxes.forEach(cb => { cb.checked = allCheckbox.checked; });
            onchange();
        });
    };

    const setupOriginFilter = (origins) => createCheckboxFilter(originFilterContainer, origins, 'origin', updateMapView);
    const setupProductFilters = (products) => createCheckboxFilter(productFilterContainer, products, 'product', updateMapView);
    
    const setupModeFilters = (modes) => {
        filtersContainer.innerHTML = ''; layerGroups = {};
        modes.sort().forEach(mode => {
            layerGroups[mode] = L.layerGroup();
            const color = transportModeColorMap[mode] || transportModeColorMap["Default"];
            const filterDiv = document.createElement('div');
            filterDiv.innerHTML = `<label><input type="checkbox" name="${mode}" checked> <span class="color-box" style="background-color:${color};"></span> ${mode}</label>`;
            filterDiv.querySelector('input').addEventListener('change', updateMapView);
            filtersContainer.appendChild(filterDiv);
        });
    };

    const onMarkerClick = (e) => {
        const clickedLocationId = e.target.locationId;
        const outgoing = {}, incoming = {};
        let totalOutgoingVolume = 0, totalIncomingVolume = 0;
        finalFlowsForAnalysis.forEach(flow => {
            if (flow.origin === clickedLocationId) {
                totalOutgoingVolume += flow.volume;
                for (const material in flow.materials) {
                    if (!outgoing[material]) outgoing[material] = 0;
                    outgoing[material] += flow.materials[material];
                }
            }
            if (flow.destination === clickedLocationId) {
                totalIncomingVolume += flow.volume;
                for (const material in flow.materials) {
                    if (!incoming[material]) incoming[material] = 0;
                    incoming[material] += flow.materials[material];
                }
            }
        });
        let popupContent = `<div class="location-popup"><b>Resumo de ${clickedLocationId}</b><br><b style="color: #c0392b;">Total Saídas:</b> ${new Intl.NumberFormat('pt-BR').format(totalOutgoingVolume.toFixed(2))}<br><b style="color: #27ae60;">Total Entradas:</b> ${new Intl.NumberFormat('pt-BR').format(totalIncomingVolume.toFixed(2))}`;
        popupContent += '<h4>SAÍDAS</h4>';
        if (Object.keys(outgoing).length > 0) { popupContent += '<ul>'; Object.entries(outgoing).sort(([,a],[,b]) => b-a).forEach(([mat, vol]) => { popupContent += `<li>${mat}: ${new Intl.NumberFormat('pt-BR').format(vol.toFixed(2))}</li>`; }); popupContent += '</ul>'; } else { popupContent += '<p>Nenhum fluxo de saída registrado.</p>'; }
        popupContent += '<h4>ENTRADAS</h4>';
        if (Object.keys(incoming).length > 0) { popupContent += '<ul>'; Object.entries(incoming).sort(([,a],[,b]) => b-a).forEach(([mat, vol]) => { popupContent += `<li>${mat}: ${new Intl.NumberFormat('pt-BR').format(vol.toFixed(2))}</li>`; }); popupContent += '</ul>'; } else { popupContent += '<p>Nenhum fluxo de entrada registrado.</p>'; }
        popupContent += '</div>';
        L.popup().setLatLng(e.latlng).setContent(popupContent).openOn(map);
    };
    
    const calculateAndShowHighlights = () => {
        highlightsContentBody.innerHTML = '<p>Funcionalidade de Highlights a ser implementada.</p>';
    };

    const getLocationGroup = (locationId) => {
        const id = locationId.toUpperCase();
        if (id.includes('CLIENTE') || id.includes('CLI')) return 'Cliente';
        if (id.includes('TERCEIRO') || id.includes('TER')) return 'Terceiro';
        if (id.startsWith('USI') || id.includes('USINA') || id.includes('PROP')) return 'Proprio';
        return "Default";
    };

    const calculateCo2Emissions = () => {
        const factors = {
            RODO: parseFloat(document.getElementById('co2-rodo').value) || 0,
            FERRO: parseFloat(document.getElementById('co2-ferro').value) || 0,
            MARITIMO: parseFloat(document.getElementById('co2-maritimo').value) || 0
        };
        const emissions = { RODO: 0, FERRO: 0, MARITIMO: 0, Outros: 0 };
        const totalVolumeByMode = { RODO: 0, FERRO: 0, MARITIMO: 0, Outros: 0 };
        finalFlowsForAnalysis.forEach(flow => {
            const mode = flow.transportMode.toUpperCase();
            const factor = factors[mode];
            const volume = flow.volume;
            if (factor !== undefined) {
                const emission = (volume * flow.distance * factor) / 1000;
                emissions[mode] += emission;
                totalVolumeByMode[mode] += volume;
            } else {
                emissions.Outros += 0;
                totalVolumeByMode.Outros += volume;
            }
        });
        const totalEmission = emissions.RODO + emissions.FERRO + emissions.MARITIMO + emissions.Outros;
        
        // Formatação dos números
        const formatNumber = (num, decimalPlaces) => {
            return new Intl.NumberFormat('pt-BR', {
                minimumFractionDigits: decimalPlaces,
                maximumFractionDigits: decimalPlaces
            }).format(num);
        };

        const resultsContainer = document.getElementById('co2-results-container');
        resultsContainer.innerHTML = `
            <h4>Resultados (toneladas de CO2eq)</h4>
            <p><strong>Rodoviário:</strong> ${formatNumber(emissions.RODO, 4)} (Volume: ${formatNumber(totalVolumeByMode.RODO, 2)} t)</p>
            <p><strong>Ferroviário:</strong> ${formatNumber(emissions.FERRO, 4)} (Volume: ${formatNumber(totalVolumeByMode.FERRO, 2)} t)</p>
            <p><strong>Hidroviário/Marítimo:</strong> ${formatNumber(emissions.MARITIMO, 4)} (Volume: ${formatNumber(totalVolumeByMode.MARITIMO, 2)} t)</p>
            <hr>
            <p><strong>Total Geral:</strong> ${formatNumber(totalEmission, 4)}</p>
        `;
    };

    // --- 5. Vinculação Final dos Eventos ---
    flowsFileInput.addEventListener('change', handleFlowsFile);
    locationsFileInput.addEventListener('change', handleLocationsFile);
    lanesFileInput.addEventListener('change', handleLanesFile);
    runButton.addEventListener('click', processDataAndCreateLayers);
    highlightsButton.addEventListener('click', () => { calculateAndShowHighlights(); highlightsPanel.classList.toggle('visible'); });
    closeHighlightsButton.addEventListener('click', () => highlightsPanel.classList.remove('visible'));
    document.querySelectorAll('input[name="geo-filter"]').forEach(radio => radio.addEventListener('change', updateMapView));
    thicknessSlider.addEventListener('input', updateMapView);
    markerRadiusSlider.addEventListener('input', updateMapView);
    co2Button.addEventListener('click', () => co2Modal.classList.add('visible'));
    closeCo2ModalButton.addEventListener('click', () => co2Modal.classList.remove('visible'));
    calculateCo2Button.addEventListener('click', calculateCo2Emissions);
});