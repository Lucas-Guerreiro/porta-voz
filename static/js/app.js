document.addEventListener('DOMContentLoaded', () => {
    // Detect environment (Vercel static fallback vs API mode)
    let IS_VERCEL_STATIC = window.location.hostname.endsWith('.vercel.app') || window.location.hostname.includes('vercel') || window.location.search.includes('mock=true');
    const eventChannel = window.BroadcastChannel ? new BroadcastChannel('porta-voz-events') : null;

    // 1. DOM Elements - Form & General
    const form = document.getElementById('denuncia-form');
    const formCard = document.getElementById('form-card');
    const successCard = document.getElementById('success-card');
    const anonimoCheckbox = document.getElementById('anonimo');
    const identificacaoContainer = document.getElementById('identificacao-container');
    const nomeInput = document.getElementById('nome');
    const contatoInput = document.getElementById('contato');
    const btnEnviar = document.getElementById('btn-enviar');
    const btnNovo = document.getElementById('btn-novo');
    const protocoloId = document.getElementById('protocolo-id');
    const btnAcompanharNovo = document.getElementById('btn-acompanhar-novo');

    // 2. DOM Elements - Tabs Navigation
    const tabEnviar = document.getElementById('tab-enviar');
    const tabAcompanhar = document.getElementById('tab-acompanhar');
    
    // 3. DOM Elements - Tracking Section
    const trackingCard = document.getElementById('tracking-card');
    const trackingForm = document.getElementById('tracking-form');
    const trackingIdInput = document.getElementById('tracking-id');
    const btnConsultar = document.getElementById('btn-consultar');
    const trackingResult = document.getElementById('tracking-result');
    const trackingNotFound = document.getElementById('tracking-not-found');
    
    const resultProto = document.getElementById('result-proto');
    const resultStatusBadge = document.getElementById('result-status-badge');
    const resultDescricao = document.getElementById('result-descricao');
    const resultTipo = document.getElementById('result-tipo');
    const resultLocal = document.getElementById('result-local');
    const resultDataOcorrencia = document.getElementById('result-data-ocorrencia');
    const resultDataEnvio = document.getElementById('result-data-envio');
    const statusExplanation = document.getElementById('status-explanation');

    // Set max date for occurrence date picker to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('data_ocorrencia').setAttribute('max', today);

    // Dynamic Database mode detection
    checkDatabaseMode();

    async function checkDatabaseMode() {
        if (IS_VERCEL_STATIC) {
            try {
                const response = await fetch('/api/status?_t=' + Date.now());
                if (response.ok) {
                    const data = await response.json();
                    console.log("ℹ️ VOZ SEGURA: Resposta do servidor:", data);
                    if (data.database === 'postgres') {
                        // Vercel Serverless has a Postgres database connected! Switch to API mode
                        IS_VERCEL_STATIC = false;
                        console.log("🟢 VOZ SEGURA: Banco PostgreSQL detectado no Vercel. Operando em Modo API.");
                    } else {
                        console.log("ℹ️ VOZ SEGURA: Rodando no Vercel (Modo LocalStorage/Simulação). Motivo: Banco PostgreSQL não configurado no Vercel.");
                    }
                } else {
                    console.log("ℹ️ VOZ SEGURA: Rodando no Vercel (Modo LocalStorage/Simulação). Motivo: Resposta da API inválida.");
                }
            } catch (e) {
                console.error("ℹ️ VOZ SEGURA: Erro ao detectar banco de dados:", e);
                console.log("ℹ️ VOZ SEGURA: Rodando no Vercel (Modo LocalStorage/Simulação).");
            }
        } else {
            console.log("🟢 VOZ SEGURA: Operando em Modo API local/Render.");
        }
    }

    // ==========================================
    // TABS NAVIGATION LOGIC
    // ==========================================
    tabEnviar.addEventListener('click', () => switchTab('enviar'));
    tabAcompanhar.addEventListener('click', () => switchTab('acompanhar'));

    function switchTab(target) {
        if (target === 'enviar') {
            tabEnviar.classList.add('active');
            tabAcompanhar.classList.remove('active');
            
            formCard.classList.remove('hidden');
            trackingCard.classList.add('hidden');
            successCard.classList.add('hidden');
        } else if (target === 'acompanhar') {
            tabAcompanhar.classList.add('active');
            tabEnviar.classList.remove('active');
            
            trackingCard.classList.remove('hidden');
            formCard.classList.add('hidden');
            successCard.classList.add('hidden');
            
            trackingIdInput.focus();
        }
    }

    // Toggle anonymous personal fields visibility
    anonimoCheckbox.addEventListener('change', () => {
        if (anonimoCheckbox.checked) {
            identificacaoContainer.classList.remove('visible');
            setTimeout(() => {
                nomeInput.value = '';
                contatoInput.value = '';
                clearInputError(nomeInput);
                clearInputError(contatoInput);
            }, 300);
        } else {
            identificacaoContainer.classList.add('visible');
        }
    });

    // ==========================================
    // NEW DENUNCIA FORM SUBMISSION
    // ==========================================
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!validateForm()) {
            const firstInvalid = form.querySelector('.invalid input, .invalid select, .invalid textarea');
            if (firstInvalid) {
                firstInvalid.focus();
            }
            return;
        }

        const payload = {
            descricao: document.getElementById('descricao').value.trim(),
            tipo: document.getElementById('tipo').value,
            data_ocorrencia: document.getElementById('data_ocorrencia').value,
            local: document.getElementById('local').value,
            detalhes: document.getElementById('detalhes').value.trim(),
            anonimo: anonimoCheckbox.checked,
            nome: anonimoCheckbox.checked ? null : nomeInput.value.trim(),
            contato: anonimoCheckbox.checked ? null : contatoInput.value.trim()
        };

        setLoading(btnEnviar, true);

        if (IS_VERCEL_STATIC) {
            // LocalStorage Simulation Mode
            setTimeout(() => {
                try {
                    const localData = localStorage.getItem('denuncias');
                    const currentList = localData ? JSON.parse(localData) : [];
                    
                    const nextId = currentList.length > 0 ? Math.max(...currentList.map(d => d.id)) + 1 : 1;
                    const dateNow = new Date();
                    
                    const newDenuncia = {
                        id: nextId,
                        descricao: payload.descricao,
                        tipo: payload.tipo,
                        data_ocorrencia: payload.data_ocorrencia,
                        local: payload.local,
                        detalhes: payload.detalhes,
                        anonimo: payload.anonimo,
                        nome: payload.nome,
                        contato: payload.contato,
                        status: 'Nova',
                        data_envio: dateNow.getFullYear() + '-' + 
                                    String(dateNow.getMonth() + 1).padStart(2, '0') + '-' + 
                                    String(dateNow.getDate()).padStart(2, '0') + ' ' + 
                                    String(dateNow.getHours()).padStart(2, '0') + ':' + 
                                    String(dateNow.getMinutes()).padStart(2, '0') + ':' + 
                                    String(dateNow.getSeconds()).padStart(2, '0')
                    };
                    
                    currentList.unshift(newDenuncia);
                    localStorage.setItem('denuncias', JSON.stringify(currentList));
                    
                    // Broadcast event to admin tab
                    if (eventChannel) {
                        eventChannel.postMessage({
                            type: 'nova_denuncia',
                            data: newDenuncia
                        });
                    }
                    
                    showSuccess(nextId);
                } catch (err) {
                    alert('Erro no simulador local: ' + err.message);
                } finally {
                    setLoading(btnEnviar, false);
                }
            }, 800); // Simulate network latency
        } else {
            // Standard API Mode
            try {
                const response = await fetch('/api/denuncias', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'Erro ao registrar denúncia');
                }

                showSuccess(result.id);

            } catch (error) {
                alert('Erro: ' + error.message);
            } finally {
                setLoading(btnEnviar, false);
            }
        }
    });

    // Success screen buttons redirection
    btnNovo.addEventListener('click', resetForm);
    
    btnAcompanharNovo.addEventListener('click', () => {
        // Retrieve protocol ID from success screen (extract just numbers)
        const rawId = protocoloId.textContent.replace('#', '');
        
        // Reset form details for next report session
        resetForm();
        
        // Navigate to tracking
        switchTab('acompanhar');
        trackingIdInput.value = rawId;
        
        // Execute lookup immediately
        queryProtocol(rawId);
    });

    function resetForm() {
        form.reset();
        anonimoCheckbox.checked = true;
        identificacaoContainer.classList.remove('visible');
        
        form.querySelectorAll('.form-group').forEach(group => {
            group.classList.remove('invalid');
            const errorSpan = group.querySelector('.error-msg');
            if (errorSpan) errorSpan.style.display = 'none';
        });

        successCard.classList.add('hidden');
        formCard.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ==========================================
    // TRACKING REPORT LOOKUP
    // ==========================================
    trackingForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const rawValue = trackingIdInput.value.trim();
        // Extract numbers from typing (handles '#0014' or '0014' or '14')
        const protocolIdValue = rawValue.replace(/[^\d]/g, '');

        if (!protocolIdValue) {
            setInputError(trackingIdInput);
            return;
        }
        clearInputError(trackingIdInput);
        
        queryProtocol(protocolIdValue);
    });

    async function queryProtocol(id) {
        setLoading(btnConsultar, true);
        trackingResult.classList.add('hidden');
        trackingNotFound.classList.add('hidden');

        if (IS_VERCEL_STATIC) {
            // LocalStorage Simulation Mode
            setTimeout(() => {
                try {
                    const localData = localStorage.getItem('denuncias');
                    const currentList = localData ? JSON.parse(localData) : [];
                    
                    const found = currentList.find(d => d.id === parseInt(id));
                    if (!found) {
                        throw new Error('Protocolo não encontrado');
                    }
                    
                    displayTrackingResult(found);
                } catch (error) {
                    trackingNotFound.classList.remove('hidden');
                } finally {
                    setLoading(btnConsultar, false);
                }
            }, 400); // Simulate network latency
        } else {
            // Standard API Mode
            try {
                const response = await fetch(`/api/denuncias/${id}/publica`);
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Protocolo não encontrado');
                }

                displayTrackingResult(data);

            } catch (error) {
                trackingNotFound.classList.remove('hidden');
            } finally {
                setLoading(btnConsultar, false);
            }
        }
    }

    function displayTrackingResult(data) {
        // Populate query result
        resultProto.textContent = `Protocolo #${String(data.id).padStart(4, '0')}`;
        
        // Set Status Badge styling
        resultStatusBadge.className = 'badge';
        let badgeClass = 'badge-nova';
        let explanationClass = 'status-nova';
        let explanationHtml = '';
        
        if (data.status === 'Nova') {
            badgeClass = 'badge-nova';
            explanationClass = 'status-nova';
            explanationHtml = '<strong>🔴 Nova:</strong> Sua ocorrência foi registrada com sucesso no sistema e está na fila para triagem pela coordenação. Nenhuma ação é necessária por sua parte no momento.';
        } else if (data.status === 'Em análise') {
            badgeClass = 'badge-analise';
            explanationClass = 'status-analise';
            explanationHtml = '<strong>🟡 Em análise:</strong> A equipe pedagógica e de coordenação está analisando as informações fornecidas, as testemunhas apontadas e definindo as medidas de intervenção apropriadas.';
        } else if (data.status === 'Em atendimento') {
            badgeClass = 'badge-atendimento';
            explanationClass = 'status-atendimento';
            explanationHtml = '<strong>🔵 Em atendimento:</strong> As providências já estão em andamento. A coordenação está conversando com os envolvidos e prestando o suporte institucional necessário.';
        } else if (data.status === 'Resolvida') {
            badgeClass = 'badge-resolvida';
            explanationClass = 'status-resolvida';
            explanationHtml = '<strong>🟢 Resolvida:</strong> A ocorrência foi concluída e resolvida pela equipe escolar. As devidas ações foram aplicadas e monitoradas.';
        } else if (data.status === 'Arquivada') {
            badgeClass = 'badge-arquivada';
            explanationClass = 'status-arquivada';
            explanationHtml = '<strong>⚪ Arquivada:</strong> O processo referente a esta ocorrência foi encerrado e arquivado pela coordenação responsável.';
        }
        
        resultStatusBadge.classList.add(badgeClass);
        resultStatusBadge.textContent = data.status;
        
        // Populate text items
        resultDescricao.textContent = data.descricao;
        resultTipo.textContent = data.tipo;
        resultLocal.textContent = data.local;
        resultDataOcorrencia.textContent = formatarData(data.data_ocorrencia);
        resultDataEnvio.textContent = formatarDataHora(data.data_envio);
        
        // Render explanation card
        statusExplanation.className = `status-explanation-card ${explanationClass}`;
        statusExplanation.innerHTML = explanationHtml;
        
        // Display Results
        trackingResult.classList.remove('hidden');
    }

    // ==========================================
    // UTILITY HELPER FUNCTIONS
    // ==========================================
    function validateForm() {
        let isValid = true;
        
        const descEl = document.getElementById('descricao');
        if (!descEl.value.trim()) {
            setInputError(descEl);
            isValid = false;
        } else if (descEl.value.trim().length > 15) {
            setInputError(descEl);
            isValid = false;
        } else {
            clearInputError(descEl);
        }

        if (!document.getElementById('tipo').value) {
            setInputError(document.getElementById('tipo'));
            isValid = false;
        } else {
            clearInputError(document.getElementById('tipo'));
        }

        if (!document.getElementById('data_ocorrencia').value) {
            setInputError(document.getElementById('data_ocorrencia'));
            isValid = false;
        } else {
            clearInputError(document.getElementById('data_ocorrencia'));
        }

        if (!document.getElementById('local').value) {
            setInputError(document.getElementById('local'));
            isValid = false;
        } else {
            clearInputError(document.getElementById('local'));
        }

        if (!anonimoCheckbox.checked) {
            if (!nomeInput.value.trim()) {
                setInputError(nomeInput);
                isValid = false;
            } else {
                clearInputError(nomeInput);
            }

            if (!contatoInput.value.trim()) {
                setInputError(contatoInput);
                isValid = false;
            } else {
                clearInputError(contatoInput);
            }
        }

        return isValid;
    }

    function setInputError(inputElement) {
        const group = inputElement.closest('.form-group');
        group.classList.add('invalid');
        const errorSpan = group.querySelector('.error-msg');
        if (errorSpan) errorSpan.style.display = 'flex';
    }

    function clearInputError(inputElement) {
        const group = inputElement.closest('.form-group');
        group.classList.remove('invalid');
        const errorSpan = group.querySelector('.error-msg');
        if (errorSpan) errorSpan.style.display = 'none';
    }

    form.querySelectorAll('.form-input').forEach(input => {
        const eventType = input.tagName === 'SELECT' ? 'change' : 'input';
        input.addEventListener(eventType, () => {
            if (input.value.trim() !== '') clearInputError(input);
        });
    });

    trackingIdInput.addEventListener('input', () => {
        if (trackingIdInput.value.trim() !== '') clearInputError(trackingIdInput);
    });

    function setLoading(btnElement, isLoading) {
        if (isLoading) {
            btnElement.disabled = true;
            btnElement.querySelector('.btn-text').style.opacity = '0.5';
            btnElement.querySelector('.btn-spinner').style.display = 'block';
        } else {
            btnElement.disabled = false;
            btnElement.querySelector('.btn-text').style.opacity = '1';
            btnElement.querySelector('.btn-spinner').style.display = 'none';
        }
    }

    function showSuccess(id) {
        const paddedId = String(id).padStart(4, '0');
        protocoloId.textContent = `#${paddedId}`;
        
        formCard.classList.add('hidden');
        successCard.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
