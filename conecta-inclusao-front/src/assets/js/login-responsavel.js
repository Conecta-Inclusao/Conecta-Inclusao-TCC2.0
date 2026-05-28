async function loginResponsavelAPI(email, password) {
    try {
        const response = await fetch('http://localhost:3000/auth/login/responsavel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ identifier: email, password })
        });
        const result = await response.json();
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('Erro na requisição:', error);
        return { ok: false, data: { message: 'Erro de conexão' } };
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginFormResponsavel');
    if (!loginForm) return;

    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const btn = e.target.querySelector('.btn-login');
        const originalText = btn.innerText;
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        if (!email || password.length < 8) {
            showPopup('Por favor, preencha e-mail válido e senha com no mínimo 8 caracteres.');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Acessando...';
        btn.style.opacity = '0.8';
        btn.style.cursor = 'not-allowed';

        const result = await loginResponsavelAPI(email, password);

        if (result.ok) {
            localStorage.setItem('token', result.data.token);
            localStorage.setItem('user', JSON.stringify(result.data.user));
            localStorage.setItem('responsavelEmail', email);
            setTimeout(() => {
                window.location.href = 'dash-responsavel.html';
            }, 600);
        } else {
            showPopup(result.data.message || 'E-mail ou senha incorretos.');
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.opacity = '';
            btn.style.cursor = '';
        }
    });
});

const style = document.createElement('style');
style.innerHTML = `
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);
