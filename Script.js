// Versão Definitiva - Correção do NaN no Popup de Localização - 22/08/2025
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
        if (!flowsData || !locationsData || !lanesData) {
            statusDiv.textContent = 'Erro: Nem todos os arquivos foram carregados corretamente.';
            return;
        }
        runButton.disabled = true;
        highlightsButton.disabled = true;

        setTimeout(() => {
            statusDiv.textContent = 'Passo 1/5: Agregando dados...';
            
            const processedFlows = {};
            flowsData
                .filter(row => String(row.triggeringEvent).trim().toLowerCase() === 'verdadeiro')
                .forEach(row => {
                    const origin = String(row['triggeringEventOriginLocationId']).trim();
                    const destination = String(row['triggeringEventDestinationLocationId']).trim();
                    const material = String(row['referenceMaterialId']).trim() || 'Desconhecido';
                    const key = `${origin}->${destination}->${material}`;
                    const dreLine = String(row['dreLineType']).trim().toLowerCase();

                    const quantity = parseFloat(String(row['triggeringEventQuantity']).replace(',', '.')) || 0;
                    const value = parseFloat(String(row['triggeringEventValue']).replace(',', '.')) || 0;
                    const hasIncentive = dreLine.includes('taxes');

                    if (!processedFlows[key]) {
                        processedFlows[key] = {
                            origin: origin,
                            destination: destination,
                            material: material,
                            quantity: quantity,
                            finalValue: 0,
                            hasIncentive: hasIncentive
                        };
                    }
                    processedFlows[key].finalValue += value;
                });
            
            const aggregatedByRoute = {};
            Object.values(processedFlows).forEach(flow => {
                const routeKey = `${flow.origin}->${flow.destination}`;
                if (!aggregatedByRoute[routeKey]) {
                    aggregatedByRoute[routeKey] = {
                        origin: flow.origin,
                        destination: flow.destination,
                        withIncentive: { volume: 0, value: 0, materials: {} },
                        withoutIncentive: { volume: 0, value: 0, materials: {} }
                    };
                }
                const route = aggregatedByRoute[routeKey];
                const targetGroup = flow.hasIncentive ? route.withIncentive : route.withoutIncentive;
                
                targetGroup.volume += flow.quantity;
                targetGroup.value += flow.finalValue;
                if (!targetGroup.materials[flow.material]) {
                    targetGroup.materials[flow.material] = { quantity: 0, value: 0 };
                }
                targetGroup.materials[flow.material].quantity += flow.quantity;
                targetGroup.materials[flow.material].value += flow.finalValue;
            });
            finalFlowsForAnalysis = Object.values(aggregatedByRoute);
            
            statusDiv.textContent = 'Passo 2/5: Processando localizações e trechos...';
            const transportModeMap = lanesData.reduce((acc, row) => {
                const origin = String(row['Origin Location Id']).trim();
                const dest = String(row['Destination Location Id']).trim();
                if (origin && dest) acc[`${origin}->${dest}`] = { mode: String(row['Trecho']).trim() };
                return acc;
            }, {});
            locationInfo = locationsData.reduce((acc, row) => {
                const locId = String(row['Location Id']).trim();
                if (locId) acc[locId] = { lat: row['Latitude'], lon: row['Longitude'], country: String(row['Country']).trim() };
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
                const allMaterials = {...flow.withIncentive.materials, ...flow.withoutIncentive.materials };
                Object.keys(allMaterials).forEach(material => uniqueProducts.add(material));

                const originCoords = locationCoords[flow.origin];
                const destCoords = locationCoords[flow.destination];
                if (originCoords && destCoords) {
                    const laneInfo = transportModeMap[`${flow.origin}->${flow.destination}`] || { mode: "Default" };
                    const transportMode = laneInfo.mode;
                    uniqueModes.add(transportMode);
                    const color = transportModeColorMap[transportMode] || transportModeColorMap["Default"];
                    const polyline = L.polyline([originCoords, destCoords], { color: color, opacity: 0.7 });
                    
                    const originCountry = locationInfo[flow.origin]?.country;
                    const destCountry = locationInfo[flow.destination]?.country;
                    let marketType = (originCountry === 'Brasil' && destCountry === 'Brasil') ? 'mi' : 'me';

                    const totalVolume = flow.withIncentive.volume + flow.withoutIncentive.volume;
                    polyline.flowData = { ...flow, transportMode, market: marketType, totalVolume: totalVolume };
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
                    circleMarker.on('click', onMarkerClick);
                    allMarkers[locId] = circleMarker;
                }
            });

            statusDiv.textContent = 'Passo 4/5: Configurando filtros...';
            setupModeFilters(Array.from(uniqueModes));
            setupProductFilters(Array.from(uniqueProducts));
            
            statusDiv.textContent = 'Passo 5/5: Desenhando mapa...';
            vizControls.style.display = 'block';
            updateMapView();
            runButton.disabled = false;
            highlightsButton.disabled = false;
        }, 10);
    };

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
            const allMaterialsOnRoute = {...p.flowData.withIncentive.materials, ...p.flowData.withoutIncentive.materials};

            if (selectAllProducts) productMatch = true;
            else if (selectedProducts.length > 0) productMatch = selectedProducts.some(product => allMaterialsOnRoute[product]);
            else if (selectedProducts.length === 0) productMatch = false; 
            return marketMatch && productMatch;
        });

        if (visiblePolylines.length === 0) {
            statusDiv.textContent = "Nenhum fluxo visível para os filtros selecionados.";
        } else {
            const volumes = visiblePolylines.map(p => p.flowData.totalVolume).filter(v => v > 0);
            const minVolume = Math.min(...volumes);
            const maxVolume = Math.max(...volumes);

            visiblePolylines.forEach(p => {
                let weight = 3;
                if (maxVolume > minVolume) {
                    const normalizedVolume = (p.flowData.totalVolume - minVolume) / (maxVolume - minVolume);
                    weight = 2 + (normalizedVolume * 15 * thicknessMultiplier);
                }
                p.setStyle({ weight });

                const flow = p.flowData;
                let popupContent = `<b>Modo:</b> ${flow.transportMode}<br><b>De:</b> ${flow.origin}<br><b>Para:</b> ${flow.destination}`;
                
                const createMaterialsList = (materials) => {
                    let html = '<ul class="materials-list">';
                    const sortedMaterials = Object.entries(materials).sort(([,a],[,b]) => b.quantity - a.quantity);
                    sortedMaterials.forEach(([name, data]) => {
                        html += `<li>${name}: ${new Intl.NumberFormat('pt-BR').format(data.quantity.toFixed(2))}</li>`;
                    });
                    html += '</ul>';
                    return html;
                };

                if (flow.withoutIncentive.volume > 0) {
                    const unitValue = flow.withoutIncentive.value / flow.withoutIncentive.volume;
                    popupContent += `
                        <div class="popup-section">
                            <b>Produtos sem Incentivo:</b><br>
                            - Volume: ${new Intl.NumberFormat('pt-BR').format(flow.withoutIncentive.volume.toFixed(2))}<br>
                            - Valor Final: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(flow.withoutIncentive.value)}<br>
                            - <b>Valor Unitário: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(unitValue)}</b>
                            ${createMaterialsList(flow.withoutIncentive.materials)}
                        </div>`;
                }

                if (flow.withIncentive.volume > 0) {
                    const unitValue = flow.withIncentive.value / flow.withIncentive.volume;
                     popupContent += `
                        <div class="popup-section">
                            <b>Produtos com Incentivo (Taxas):</b><br>
                            - Volume: ${new Intl.NumberFormat('pt-BR').format(flow.withIncentive.volume.toFixed(2))}<br>
                            - Valor Final: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(flow.withIncentive.value)}<br>
                            - <b>Valor Unitário: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(unitValue)}</b>
                            ${createMaterialsList(flow.withIncentive.materials)}
                        </div>`;
                }

                popupContent += `<hr style="margin: 4px 0;"><b>Volume Total na Rota: ${new Intl.NumberFormat('pt-BR').format(flow.totalVolume.toFixed(2))}</b>`;
                p.bindPopup(popupContent);

                if (layerGroups[flow.transportMode]) {
                    layerGroups[flow.transportMode].addLayer(p);
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
    
    // Demais funções (setupProductFilters, setupModeFilters, onMarkerClick, etc.)
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

    // --- INÍCIO DA MODIFICAÇÃO: Correção do cálculo de volume total ---
    const onMarkerClick = (e) => {
        const clickedLocationId = e.target.locationId;
        const outgoing = {};
        const incoming = {};
        let totalOutgoingVolume = 0;
        let totalIncomingVolume = 0;

        finalFlowsForAnalysis.forEach(flow => {
            // Usa a variável `totalVolume` que já foi calculada e está no objeto
            const currentTotalVolume = flow.withIncentive.volume + flow.withoutIncentive.volume;

            const allMaterials = {...flow.withIncentive.materials, ...flow.withoutIncentive.materials};
            if (flow.origin === clickedLocationId) {
                totalOutgoingVolume += currentTotalVolume;
                for (const material in allMaterials) {
                    if (!outgoing[material]) outgoing[material] = 0;
                    outgoing[material] += allMaterials[material].quantity;
                }
            }
            if (flow.destination === clickedLocationId) {
                totalIncomingVolume += currentTotalVolume;
                for (const material in allMaterials) {
                    if (!incoming[material]) incoming[material] = 0;
                    incoming[material] += allMaterials[material].quantity;
                }
            }
        });

        let popupContent = `<div class="location-popup"><b>Resumo de ${clickedLocationId}</b><br>`;
        popupContent += `<b style="color: #c0392b;">Total Saídas:</b> ${new Intl.NumberFormat('pt-BR').format(totalOutgoingVolume.toFixed(2))}<br>`;
        popupContent += `<b style="color: #27ae60;">Total Entradas:</b> ${new Intl.NumberFormat('pt-BR').format(totalIncomingVolume.toFixed(2))}`;
        
        popupContent += '<h4>SAÍDAS</h4>';
        if (Object.keys(outgoing).length > 0) {
            popupContent += '<ul>';
            Object.entries(outgoing).sort(([,a],[,b]) => b-a).forEach(([mat, vol]) => {
                popupContent += `<li>${mat}: ${new Intl.NumberFormat('pt-BR').format(vol.toFixed(2))}</li>`;
            });
            popupContent += '</ul>';
        } else {
            popupContent += '<p>Nenhum fluxo de saída registrado.</p>';
        }

        popupContent += '<h4>ENTRADAS</h4>';
        if (Object.keys(incoming).length > 0) {
            popupContent += '<ul>';
            Object.entries(incoming).sort(([,a],[,b]) => b-a).forEach(([mat, vol]) => {
                popupContent += `<li>${mat}: ${new Intl.NumberFormat('pt-BR').format(vol.toFixed(2))}</li>`;
            });
            popupContent += '</ul>';
        } else {
            popupContent += '<p>Nenhum fluxo de entrada registrado.</p>';
        }
        popupContent += '</div>';

        L.popup().setLatLng(e.latlng).setContent(popupContent).openOn(map);
    };
    // --- FIM DA MODIFICAÇÃO ---

    const calculateAndShowHighlights = () => { highlightsContentBody.innerHTML = '<p>Funcionalidade de Highlights a ser implementada.</p>'; };
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
    highlightsButton.addEventListener('click', () => {
        calculateAndShowHighlights();
        highlightsPanel.classList.toggle('visible');
    });
    closeHighlightsButton.addEventListener('click', () => highlightsPanel.classList.remove('visible'));
    document.querySelectorAll('input[name="geo-filter"]').forEach(radio => radio.addEventListener('change', updateMapView));
    thicknessSlider.addEventListener('input', updateMapView);
    markerRadiusSlider.addEventListener('input', updateMapView);
});