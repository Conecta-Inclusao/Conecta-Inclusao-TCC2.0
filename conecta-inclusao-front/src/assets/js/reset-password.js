function getTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('token') || '';
}

function validateStrongPassword(password) {
    return password.length >= 8 &&
        /[a-z]/.test(password) &&
        /[A-Z]/.test(password) &&
        /\d/.test(password) &&
        /[^A-Za-z0-9]/.test(password);
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('resetPasswordForm');
    const tokenInput = document.getElementById('resetToken');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');

    tokenInput.value = getTokenFromUrl();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const token = tokenInput.value.trim();
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;
        const button = form.querySelector('button[type="submit"]');

        if (!token) {
            showPopup('Informe o token de recuperaÃ§Ã£o.');
            return;
        }

        if (!validateStrongPassword(newPassword)) {
            showPopup('A senha deve ter 8 caracteres, maiÃºscula, minÃºscula, nÃºmero e caractere especial.');
            return;
        }

        if (newPassword !== confirmPassword) {
            showPopup('As senhas nÃ£o coincidem.');
            return;
        }

        button.disabled = true;
        button.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Salvando...';

        try {
            const response = await fetch('https://conecta-inclusao.onrender.com/auth/password/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword })
            });
            const result = await response.json();

            if (!response.ok) {
                showPopup(result.message || 'Erro ao redefinir senha.');
                return;
            }

            showPopup('Senha redefinida com sucesso. VocÃª jÃ¡ pode fazer login.');
            setTimeout(() => {
                window.location.href = 'lndex.html';
            }, 1200);
        } catch (error) {
            console.error('Erro ao redefinir senha:', error);
            showPopup('Erro de conexÃ£o com o servidor.');
        } finally {
            button.disabled = false;
            button.innerText = 'Salvar nova senha';
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

