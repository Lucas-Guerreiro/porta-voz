document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-form');
    const btnLogin = document.getElementById('btn-login');
    const errorAlert = document.getElementById('error-alert');
    const errorMessage = document.getElementById('error-message');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            showError("Preencha todos os campos.");
            return;
        }

        // Hide previous errors
        errorAlert.classList.add('hidden');
        setLoading(true);

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

            // Redirect based on role
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
