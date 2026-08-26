document.addEventListener('DOMContentLoaded', () => {
    // Detect environment (Vercel static fallback vs API mode)
    let IS_VERCEL_STATIC = window.location.hostname.endsWith('.vercel.app') || window.location.hostname.includes('vercel') || window.location.search.includes('mock=true');
    
    const form = document.getElementById('login-form');
    const btnLogin = document.getElementById('btn-login');
    const errorAlert = document.getElementById('error-alert');
    const errorMessage = document.getElementById('error-message');

    // Run auth check on load
    checkAuth();

    async function checkDatabaseMode() {
        if (IS_VERCEL_STATIC) {
            try {
                const response = await fetch('/api/status?_t=' + Date.now());
                if (response.ok) {
                    const data = await response.json();
                    if (data.database === 'postgres') {
                        IS_VERCEL_STATIC = false;
                    }
                }
            } catch (e) {}
        }
    }

    async function checkAuth() {
        await checkDatabaseMode();
        
        if (IS_VERCEL_STATIC) {
            // LocalStorage Simulation Mode: check if role is already stored
            const role = localStorage.getItem('role');
            if (role === 'admin') {
                window.location.href = '/admin';
            } else if (role === 'aluno') {
                window.location.href = '/';
            }
        } else {
            // API Mode
            try {
                const response = await fetch('/api/me');
                if (response.ok) {
                    const data = await response.json();
                    if (data.role === 'admin') {
                        window.location.href = '/admin';
                    } else {
                        window.location.href = '/';
                    }
                }
            } catch (error) {}
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            showError("Preencha todos os campos.");
            return;
        }

        errorAlert.classList.add('hidden');
        setLoading(true);

        if (IS_VERCEL_STATIC) {
            // LocalStorage Simulation Mode Login
            setTimeout(() => {
                const userLower = username.toLowerCase();
                if (userLower === 'admin' && password === 'admin123') {
                    localStorage.setItem('role', 'admin');
                    window.location.href = '/admin';
                } else if (userLower === 'aluno' && password === 'aluno123') {
                    localStorage.setItem('role', 'aluno');
                    window.location.href = '/';
                } else {
                    showError("Usuário ou senha incorretos.");
                    setLoading(false);
                }
            }, 400);
        } else {
            // Standard API Mode Login
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, password })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || "Erro ao realizar login.");
                }

                if (data.role === 'admin') {
                    window.location.href = '/admin';
                } else {
                    window.location.href = '/';
                }

            } catch (error) {
                showError(error.message);
            } finally {
                setLoading(false);
            }
        }
    });

    function showError(message) {
        errorMessage.textContent = message;
        errorAlert.classList.remove('hidden');
    }

    function setLoading(isLoading) {
        if (isLoading) {
            btnLogin.disabled = true;
            btnLogin.querySelector('.btn-text').style.opacity = '0.5';
            btnLogin.querySelector('.btn-spinner').style.display = 'block';
        } else {
            btnLogin.disabled = false;
            btnLogin.querySelector('.btn-text').style.opacity = '1';
            btnLogin.querySelector('.btn-spinner').style.display = 'none';
        }
    }
});
