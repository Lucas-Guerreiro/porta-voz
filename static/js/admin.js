document.addEventListener('DOMContentLoaded', () => {
    // Detect environment (Vercel static fallback vs API mode)
    const IS_VERCEL_STATIC = window.location.hostname.endsWith('.vercel.app') || window.location.hostname.includes('vercel') || window.location.search.includes('mock=true');
    const eventChannel = window.BroadcastChannel ? new BroadcastChannel('porta-voz-events') : null;

    // State management
    let denuncias = [];
    let activeModalDenunciaId = null;

    // DOM Elements
    const connectionDot = document.getElementById('connection-dot');
    const connectionText = document.getElementById('connection-text');
    
    const countNova = document.getElementById('count-nova');
    const countAnalise = document.getElementById('count-analise');
    const countAtendimento = document.getElementById('count-atendimento');
    const countResolvida = document.getElementById('count-resolvida');
    const countTotal = document.getElementById('count-total');
    
    const chartTiposContainer = document.getElementById('chart-tipos');
    const chartLocaisContainer = document.getElementById('chart-locais');
    
    const btnLimparFiltros = document.getElementById('btn-limpar-filtros');
    const filterId = document.getElementById('filter-id');
    const filterTipo = document.getElementById('filter-tipo');
    const filterLocal = document.getElementById('filter-local');
    const filterStatus = document.getElementById('filter-status');
    const filterAnonimo = document.getElementById('filter-anonimo');
    const filterData = document.getElementById('filter-data');
    
    const tabelaCorpo = document.getElementById('tabela-corpo');
    const tableStatsCount = document.getElementById('table-stats-count');
    
    const toastContainer = document.getElementById('toast-container');
    
    // Modal Elements
    const detalhesModal = document.getElementById('detalhes-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalId = document.getElementById('modal-id');
    const modalStatusSelect = document.getElementById('modal-status-select');
    const modalStatusLoader = document.getElementById('modal-status-loader');
    const modalDescricao = document.getElementById('modal-descricao');
    const modalTipo = document.getElementById('modal-tipo');
    const modalDataOcorrencia = document.getElementById('modal-data-ocorrencia');
    const modalLocal = document.getElementById('modal-local');
    const modalDataEnvio = document.getElementById('modal-data-envio');
    const modalDetalhes = document.getElementById('modal-detalhes');
    const modalIdentificacao = document.getElementById('modal-identificacao');
    const modalIdentificacaoBox = document.getElementById('modal-identificacao-box');

    // Initial load
    init();

    async function init() {
        await fetchDenuncias();
        setupSSE();
        setupFilterListeners();
        setupModalListeners();
        setupDashboardCardClicks();
    }

    // Fetch reports from API or LocalStorage
    async function fetchDenuncias() {
        if (IS_VERCEL_STATIC) {
            // LocalStorage Simulation Mode
            try {
                const localData = localStorage.getItem('denuncias');
                denuncias = localData ? JSON.parse(localData) : [];
                updateUI();
            } catch (error) {
                console.error(error);
                tabelaCorpo.innerHTML = `<tr><td colspan="7" class="td-empty" style="color: var(--status-nova-text)">❌ Erro ao ler dados do localStorage: ${error.message}</td></tr>`;
            }
        } else {
            // Standard API Mode
            try {
                const response = await fetch('/api/denuncias');
                if (!response.ok) throw new Error('Erro ao obter dados do servidor');
                denuncias = await response.json();
                updateUI();
            } catch (error) {
                console.error(error);
                tabelaCorpo.innerHTML = `<tr><td colspan="7" class="td-empty" style="color: var(--status-nova-text)">❌ Erro ao conectar com a API: ${error.message}</td></tr>`;
            }
        }
    }

    // Set up EventSource for SSE (Real-time updates) or BroadcastChannel (Vercel)
    function setupSSE() {
        if (IS_VERCEL_STATIC) {
            // Local tab-to-tab sync using BroadcastChannel
            connectionDot.className = 'status-indicator-dot online';
            connectionText.textContent = 'Simulador Local Ativo';
            
            if (eventChannel) {
                eventChannel.onmessage = (event) => {
                    const eventData = event.data;
                    
                    if (eventData.type === 'nova_denuncia') {
                        const newDenuncia = eventData.data;
                        // Avoid duplicates in memory, reload from localStorage
                        const localData = localStorage.getItem('denuncias');
                        denuncias = localData ? JSON.parse(localData) : [];
                        
                        showToast(newDenuncia);
                        updateUI();
                    } else if (eventData.type === 'status_atualizado') {
                        const updatedDenuncia = eventData.data;
                        const index = denuncias.findIndex(d => d.id === updatedDenuncia.id);
                        if (index !== -1) {
                            denuncias[index].status = updatedDenuncia.status;
                            
                            if (activeModalDenunciaId === updatedDenuncia.id) {
                                modalStatusSelect.value = updatedDenuncia.status;
                            }
                            
                            updateUI();
                        }
                    }
                };
            }
        } else {
            // Standard Live API Mode
            const source = new EventSource('/api/sse');

            source.onopen = () => {
                connectionDot.className = 'status-indicator-dot online';
                connectionText.textContent = 'Conectado em tempo real';
            };

            source.onerror = (err) => {
                console.error('SSE Error:', err);
                connectionDot.className = 'status-indicator-dot offline';
                connectionText.textContent = 'Desconectado';
            };

            source.onmessage = (event) => {
                const eventData = JSON.parse(event.data);
                
                if (eventData.type === 'ping') {
                    return; // Connection check
                }

                if (eventData.type === 'nova_denuncia') {
                    const newDenuncia = eventData.data;
                    if (!denuncias.some(d => d.id === newDenuncia.id)) {
                        denuncias.unshift(newDenuncia);
                        showToast(newDenuncia);
                        updateUI();
                    }
                } else if (eventData.type === 'status_atualizado') {
                    const updatedDenuncia = eventData.data;
                    const index = denuncias.findIndex(d => d.id === updatedDenuncia.id);
                    if (index !== -1) {
                        denuncias[index].status = updatedDenuncia.status;
                        
                        if (activeModalDenunciaId === updatedDenuncia.id) {
                            modalStatusSelect.value = updatedDenuncia.status;
                        }
                        
                        updateUI();
                    }
                }
            };
        }
    }

    // Core UI rendering updates
    function updateUI() {
        updateDashboardCounters();
        renderCharts();
        applyFiltersAndRenderTable();
    }

    // Calculate and update Dashboard Card Numbers
    function updateDashboardCounters() {
        let countN = 0;
        let countAn = 0;
        let countAt = 0;
        let countR = 0;
        let total = 0;

        denuncias.forEach(d => {
            total++;
            if (d.status === 'Nova') countN++;
            else if (d.status === 'Em análise') countAn++;
            else if (d.status === 'Em atendimento') countAt++;
            else if (d.status === 'Resolvida') countR++;
        });

        countNova.textContent = countN;
        countAnalise.textContent = countAn;
        countAtendimento.textContent = countAt;
        countResolvida.textContent = countR;
        countTotal.textContent = total;
    }

    // Draw customized CSS-based Bar Charts dynamically
    function renderCharts() {
        // 1. Tipo Occurrence Chart
        const tipoCounts = {};
        denuncias.forEach(d => {
            tipoCounts[d.tipo] = (tipoCounts[d.tipo] || 0) + 1;
        });

        const sortedTipos = Object.entries(tipoCounts).sort((a, b) => b[1] - a[1]);
        renderChartBars(sortedTipos, chartTiposContainer, 'Bullying');

        // 2. Local Chart
        const localCounts = {};
        denuncias.forEach(d => {
            localCounts[d.local] = (localCounts[d.local] || 0) + 1;
        });

        const sortedLocais = Object.entries(localCounts).sort((a, b) => b[1] - a[1]);
        renderChartBars(sortedLocais, chartLocaisContainer, 'Sala de aula');
    }

    // Sub-helper to draw CSS bar components inside parent containers
    function renderChartBars(sortedData, container, defaultEmptyLabel) {
        if (sortedData.length === 0) {
            container.innerHTML = `<div class="chart-empty">Nenhum dado registrado para exibir gráfico.</div>`;
            return;
        }

        const maxVal = sortedData[0][1]; // Highest count for scale percentage
        
        let html = '';
        sortedData.slice(0, 5).forEach(([name, count]) => {
            const percentage = maxVal > 0 ? (count / maxVal) * 100 : 0;
            html += `
                <div class="chart-bar-row">
                    <div class="chart-bar-labels">
                        <span class="chart-bar-name">${name}</span>
                        <span class="chart-bar-count">${count} (${Math.round((count / denuncias.length) * 100)}%)</span>
                    </div>
                    <div class="chart-bar-track">
                        <div class="chart-bar-fill" style="width: ${percentage}%"></div>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    }

    // Event listeners configuration for filters
    function setupFilterListeners() {
        const triggers = [filterId, filterTipo, filterLocal, filterStatus, filterAnonimo, filterData];
        triggers.forEach(el => {
            const ev = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
            el.addEventListener(ev, applyFiltersAndRenderTable);
        });

        btnLimparFiltros.addEventListener('click', () => {
            filterId.value = '';
            filterTipo.value = '';
            filterLocal.value = '';
            filterStatus.value = '';
            filterAnonimo.value = '';
            filterData.value = '';
            
            // Remove active classes on Dashboard cards
            document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active-filter'));

            applyFiltersAndRenderTable();
        });
    }

    // Handle Quick filters when clicking Dashboard Cards
    function setupDashboardCardClicks() {
        document.getElementById('card-filter-nova').addEventListener('click', () => setQuickStatusFilter('Nova', 'card-filter-nova'));
        document.getElementById('card-filter-analise').addEventListener('click', () => setQuickStatusFilter('Em análise', 'card-filter-analise'));
        document.getElementById('card-filter-atendimento').addEventListener('click', () => setQuickStatusFilter('Em atendimento', 'card-filter-atendimento'));
        document.getElementById('card-filter-resolvida').addEventListener('click', () => setQuickStatusFilter('Resolvida', 'card-filter-resolvida'));
        document.getElementById('card-filter-clear').addEventListener('click', () => {
            filterStatus.value = '';
            document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active-filter'));
            applyFiltersAndRenderTable();
        });
    }

    function setQuickStatusFilter(statusVal, cardId) {
        filterStatus.value = statusVal;
        
        document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active-filter'));
        document.getElementById(cardId).classList.add('active-filter');
        
        applyFiltersAndRenderTable();
        document.querySelector('.filters-card').scrollIntoView({ behavior: 'smooth' });
    }

    // Perform client-side filter computation and render matching entries
    function applyFiltersAndRenderTable() {
        const idVal = filterId.value.trim();
        const tipoVal = filterTipo.value;
        const localVal = filterLocal.value;
        const statusVal = filterStatus.value;
        const anonimoVal = filterAnonimo.value; // 'true', 'false', or ''
        const dataVal = filterData.value; // YYYY-MM-DD

        const filtered = denuncias.filter(d => {
            if (idVal && !String(d.id).includes(idVal)) return false;
            if (tipoVal && d.tipo !== tipoVal) return false;
            if (localVal && d.local !== localVal) return false;
            if (statusVal && d.status !== statusVal) return false;
            if (anonimoVal !== '') {
                const isAnon = anonimoVal === 'true';
                if (d.anonimo !== isAnon) return false;
            }
            if (dataVal && d.data_ocorrencia !== dataVal) return false;
            return true;
        });

        renderTable(filtered);
    }

    // Populate filtered array into list rows
    function renderTable(list) {
        if (list.length === 0) {
            tabelaCorpo.innerHTML = `<tr><td colspan="7" class="td-empty">🔍 Nenhuma denúncia encontrada para os filtros aplicados.</td></tr>`;
            tableStatsCount.textContent = `Exibindo 0 denúncia(s)`;
            return;
        }

        let html = '';
        list.forEach(d => {
            const paddedId = String(d.id).padStart(4, '0');
            const dataOcorrenciaFormatada = formatarData(d.data_ocorrencia);
            const dataEnvioFormatada = formatarDataHora(d.data_envio);
            
            // Status CSS class binding
            let statusClass = 'badge-nova';
            if (d.status === 'Em análise') statusClass = 'badge-analise';
            else if (d.status === 'Em atendimento') statusClass = 'badge-atendimento';
            else if (d.status === 'Resolvida') statusClass = 'badge-resolvida';
            else if (d.status === 'Arquivada') statusClass = 'badge-arquivada';

            // Anonymous CSS badge
            const anonimoBadge = d.anonimo 
                ? '<span class="badge-anonimo">Anônima</span>' 
                : `<span class="badge-identificado" title="${d.nome}">Identificada</span>`;

            html += `
                <tr data-id="${d.id}">
                    <td class="td-id">#${paddedId}</td>
                    <td style="font-weight: 700;">${d.tipo}</td>
                    <td>${dataOcorrenciaFormatada}</td>
                    <td>${d.local}</td>
                    <td style="color: var(--text-muted); font-size: 13px;">${dataEnvioFormatada}</td>
                    <td>${anonimoBadge}</td>
                    <td><span class="badge ${statusClass}">${d.status}</span></td>
                </tr>
            `;
        });

        tabelaCorpo.innerHTML = html;
        tableStatsCount.textContent = `Exibindo ${list.length} de ${denuncias.length} denúncia(s)`;

        // Setup row click trigger
        tabelaCorpo.querySelectorAll('tr').forEach(row => {
            row.addEventListener('click', () => {
                const id = parseInt(row.getAttribute('data-id'));
                const item = denuncias.find(d => d.id === id);
                if (item) openModal(item);
            });
        });
    }

    // Modal Operations
    function setupModalListeners() {
        modalCloseBtn.addEventListener('click', closeModal);
        
        detalhesModal.addEventListener('click', (e) => {
            if (e.target === detalhesModal) {
                closeModal();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !detalhesModal.classList.contains('hidden')) {
                closeModal();
            }
        });

        // PATCH Status changes
        modalStatusSelect.addEventListener('change', async () => {
            if (!activeModalDenunciaId) return;

            const newStatus = modalStatusSelect.value;
            modalStatusSelect.disabled = true;
            modalStatusLoader.style.display = 'inline-block';

            if (IS_VERCEL_STATIC) {
                // LocalStorage Simulation Mode
                setTimeout(() => {
                    const index = denuncias.findIndex(d => d.id === activeModalDenunciaId);
                    if (index !== -1) {
                        denuncias[index].status = newStatus;
                        localStorage.setItem('denuncias', JSON.stringify(denuncias));
                        
                        // Broadcast update to other tabs (like tracking tab)
                        if (eventChannel) {
                            eventChannel.postMessage({
                                type: 'status_atualizado',
                                data: denuncias[index]
                            });
                        }
                        
                        updateUI();
                    }
                    modalStatusSelect.disabled = false;
                    modalStatusLoader.style.display = 'none';
                }, 400); // Simulate network latency
            } else {
                // Standard API Mode
                try {
                    const response = await fetch(`/api/denuncias/${activeModalDenunciaId}/status`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ status: newStatus })
                    });

                    const result = await response.json();

                    if (!response.ok) {
                        throw new Error(result.error || 'Erro ao atualizar o status.');
                    }

                    const index = denuncias.findIndex(d => d.id === activeModalDenunciaId);
                    if (index !== -1) {
                        denuncias[index].status = result.status;
                        updateUI();
                    }

                } catch (error) {
                    alert('Erro: ' + error.message);
                    const originalItem = denuncias.find(d => d.id === activeModalDenunciaId);
                    if (originalItem) {
                        modalStatusSelect.value = originalItem.status;
                    }
                } finally {
                    modalStatusSelect.disabled = false;
                    modalStatusLoader.style.display = 'none';
                }
            }
        });
    }

    function openModal(item) {
        activeModalDenunciaId = item.id;
        
        modalId.textContent = `#${String(item.id).padStart(4, '0')}`;
        modalStatusSelect.value = item.status;
        modalDescricao.textContent = item.descricao;
        modalTipo.textContent = item.tipo;
        modalLocal.textContent = item.local;
        modalDataOcorrencia.textContent = formatarData(item.data_ocorrencia);
        modalDataEnvio.textContent = formatarDataHora(item.data_envio);
        modalDetalhes.textContent = item.detalhes ? item.detalhes : 'Nenhum detalhe adicional fornecido.';

        if (item.anonimo) {
            modalIdentificacao.className = 'info-value identificacao-card anonimo';
            modalIdentificacao.innerHTML = `
                <div style="font-weight: 700; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
                    <span>🔒</span> Denúncia Anônima
                </div>
                <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px; font-weight: 500;">
                    Nenhuma informação pessoal foi fornecida pelo denunciante.
                </div>
            `;
        } else {
            modalIdentificacao.className = 'info-value identificacao-card';
            modalIdentificacao.innerHTML = `
                <div style="font-weight: 700; color: #0369a1; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                    <span>👤</span> Denunciante Identificado
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600;">
                    <div><strong>Nome:</strong> <span style="font-weight: 500;">${item.nome}</span></div>
                    <div><strong>Meio de Contato:</strong> <span style="font-weight: 500;">${item.contato}</span></div>
                </div>
            `;
        }

        detalhesModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        detalhesModal.classList.add('hidden');
        document.body.style.overflow = 'auto';
        activeModalDenunciaId = null;
    }

    // Toast alerts logic
    function showToast(item) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        
        const paddedId = String(item.id).padStart(4, '0');
        
        toast.innerHTML = `
            <span class="toast-icon">🔔</span>
            <div class="toast-content">
                <div class="toast-title">Nova denúncia recebida</div>
                <div class="toast-msg">Protocolo #${paddedId} • Tipo: ${item.tipo}</div>
            </div>
        `;
        
        toast.addEventListener('click', () => {
            openModal(item);
            toast.remove();
        });

        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-closing');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 5000);
    }

    function formatarData(dataSql) {
        if (!dataSql) return '-';
        const parts = dataSql.split('-');
        if (parts.length !== 3) return dataSql;
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    function formatarDataHora(dataHoraSql) {
        if (!dataHoraSql) return '-';
        const parts = dataHoraSql.split(' ');
        if (parts.length !== 2) return dataHoraSql;
        
        const dateParts = parts[0].split('-');
        const timeParts = parts[1].split(':');
        
        if (dateParts.length !== 3 || timeParts.length < 2) return dataHoraSql;
        return `${dateParts[2]}/${dateParts[1]}/${dateParts[0]} às ${timeParts[0]}:${timeParts[1]}`;
    }
});
