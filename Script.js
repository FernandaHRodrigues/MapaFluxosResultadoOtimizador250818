// Versão Final - Lógica Simplificada (Apenas Leitura de Arquivo)
document.addEventListener('DOMContentLoaded', () => {
    const flowsFileInput = document.getElementById('flows-file');
    const locationsFileInput = document.getElementById('locations-file');
    const runButton = document.getElementById('run-button');
    const statusDiv = document.getElementById('status');
    const filtersContainer = document.getElementById('filters-container');
    
    let flowsData = null;
    let locationsData = null;
    let layerGroups = {};

    const map = L.map('map').setView([-14.2350, -51.9253], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    
    const colorMap = {
        "Gross Sales": "#28a745", "Sales Transfer Cost": "#fd7e14",
        "Internal Transfer Cost": "#007bff", "Production Routing Cost": "#dc3545",
        "Default": "#6c757d"
    };

    function updateRunButtonStatus() {
        if (flowsData && locationsData) {
            runButton.disabled = false;
            statusDiv.textContent = 'Arquivos prontos. Clique em "Gerar Mapa".';
        }
    }

    flowsFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        statusDiv.textContent = 'Lendo arquivo de fluxos...';
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            complete: (results) => {
                flowsData = results.data;
                locationsFileInput.disabled = false;
                statusDiv.textContent = "Fluxos carregados. Selecione o arquivo de localizações.";
                updateRunButtonStatus();
            }
        });
    });

    locationsFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        statusDiv.textContent = "Lendo arquivo de localizações...";
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            locationsData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            updateRunButtonStatus();
        };
        reader.readAsArrayBuffer(file);
    });

    runButton.addEventListener('click', () => {
        if (!flowsData || !locationsData) return;
        runButton.disabled = true;
        main();
    });

    function main() {
        // Limpeza inicial
        for (const group in layerGroups) map.removeLayer(layerGroups[group]);
        layerGroups = {};
        filtersContainer.innerHTML = '';
        statusDiv.textContent = 'Processando dados do arquivo...';

        // Filtragem e Agregação
        const filteredFlows = flowsData.filter(row => 
            String(row.triggeringEvent).trim().toLowerCase() === 'verdadeiro' &&
            row.triggeringEventOriginLocationId && row.triggeringEventDestinationLocationId && row.dreLineType
        );
        const aggregatedFlows = filteredFlows.reduce((acc, row) => {
            const key = `${row.triggeringEventOriginLocationId}->${row.triggeringEventDestinationLocationId}->${row.dreLineType}`;
            if (!acc[key]) acc[key] = { origin: row.triggeringEventOriginLocationId, destination: row.triggeringEventDestinationLocationId, volume: 0, type: row.dreLineType };
            acc[key].volume += parseFloat(row.triggeringEventQuantity) || 0;
            return acc;
        }, {});
        const finalFlows = Object.values(aggregatedFlows);

        // --- LÓGICA SIMPLIFICADA: Apenas lê do arquivo de localizações ---
        const locationCoords = locationsData.reduce((acc, row) => {
            const id = row['Location Id'];
            if (id && row.Latitude != null && row.Longitude != null) {
                acc[id] = [parseFloat(row.Latitude), parseFloat(row.Longitude)];
            }
            return acc;
        }, {});
        
        const uniqueLocations = [...new Set(finalFlows.flatMap(f => [f.origin, f.destination]))];
        const failedLocations = new Set();
        
        // Verifica quais locais não foram encontrados no arquivo
        uniqueLocations.forEach(locId => {
            if (!locationCoords[locId]) {
                failedLocations.add(locId);
            }
        });
        
        statusDiv.textContent = 'Desenhando o mapa...';
        
        // Desenha as linhas e marcadores
        finalFlows.forEach(flow => {
            const originCoords = locationCoords[flow.origin];
            const destCoords = locationCoords[flow.destination];
            if (originCoords && destCoords) {
                if (!layerGroups[flow.type]) {
                    layerGroups[flow.type] = L.layerGroup().addTo(map);
                    L.marker(originCoords).addTo(layerGroups[flow.type]).bindPopup(flow.origin);
                }
                L.marker(destCoords).addTo(layerGroups[flow.type]).bindPopup(flow.destination);

                const color = colorMap[flow.type] || colorMap["Default"];
                L.polyline([originCoords, destCoords], { color, weight: 5, opacity: 0.7 })
                 .addTo(layerGroups[flow.type])
                 .bindPopup(`<b>Tipo:</b> ${flow.type}<br><b>De:</b> ${flow.origin}<br><b>Para:</b> ${flow.destination}<br><b>Volume:</b> ${flow.volume.toFixed(2)}`);
            }
        });
        
        setupFilters();
        let statusMessage = `Mapa gerado! Use os filtros para explorar.`;
        if (failedLocations.size > 0) {
            statusMessage += `<br><br><strong style='color:red;'>Aviso:</strong> Os seguintes locais não foram encontrados no seu arquivo Excel: <br><small>${[...failedLocations].join(', ')}</small>`;
        }
        statusDiv.innerHTML = statusMessage;
        runButton.disabled = false;
    }
    
    function setupFilters() {
        filtersContainer.innerHTML = '';
        const sortedTypes = Object.keys(layerGroups).sort();
        if(sortedTypes.length === 0){
            filtersContainer.innerHTML = '<p style="font-size: 14px; color: #666;">Nenhum fluxo pôde ser desenhado. Verifique os locais faltantes.</p>';
            return;
        }
        for (const type of sortedTypes) {
            const color = colorMap[type] || colorMap["Default"];
            const div = document.createElement('div');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `filter-${type}`;
            checkbox.checked = true;
            const label = document.createElement('label');
            label.htmlFor = `filter-${type}`;
            label.innerHTML = `<span class="color-box" style="background-color: ${color};"></span> ${type}`;
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) map.addLayer(layerGroups[type]);
                else map.removeLayer(layerGroups[type]);
            });
            div.appendChild(checkbox);
            div.appendChild(label);
            filtersContainer.appendChild(div);
        }
    }
});