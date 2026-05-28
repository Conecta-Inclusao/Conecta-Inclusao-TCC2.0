// ===== FUNÇÕES DO MODAL ESQUECEU A SENHA =====
function openForgotPasswordModal(event) {
    event.preventDefault();
    document.getElementById('forgotPasswordModal').style.display = 'flex';
    document.getElementById('forgotEmail').focus();
}

function closeForgotPasswordModal() {
    document.getElementById('forgotPasswordModal').style.display = 'none';
    document.getElementById('forgotEmail').value = '';
}

async function sendResetEmail(type) {
    const identifier = document.getElementById('forgotEmail').value;
    const identifierDigits = identifier.replace(/\D/g, '');

    if (!identifierDigits || (type === 'cpf' && identifierDigits.length !== 11)) {
        showPopup("Por favor, digite um CPF válido.");
        return;
    }

    const btn = document.querySelector('#forgotPasswordModal .forgot-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Enviando...';

    try {
        const response = await fetch('http://localhost:3000/auth/password/forgot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, identifier: identifierDigits })
        });
        const result = await response.json();

        if (!response.ok) {
            showPopup(result.message || 'Erro ao enviar e-mail de recuperação.');
            return;
        }

        showPopup(`Enviamos o token de recuperação para ${result.email}. Verifique sua caixa de entrada.`);
        closeForgotPasswordModal();
    } catch (error) {
        console.error('Erro ao solicitar recuperação:', error);
        showPopup('Erro de conexão com o servidor.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Enviar Link de Recuperação';
    }
}

async function loginPacienteAPI(identifier, password) {
    try {
        const response = await fetch('http://localhost:3000/auth/login/universal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ identifier, password, expectedProfile: 'paciente' })
        });
        const result = await response.json();
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('Erro na requisição:', error);
        return { ok: false, data: { message: 'Erro de conexão' } };
    }
}

// Fechar modal ao clicar fora dele
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('forgotPasswordModal');
    if (modal) {
        modal.addEventListener('click', function(event) {
            if (event.target === modal) {
                closeForgotPasswordModal();
            }
        });
    }
});

// Máscara de CPF automática (Melhorada para performance)
document.addEventListener('DOMContentLoaded', function() {
    const cpfInput = document.getElementById('cpf');
    if (cpfInput) {
        const lastCPF = localStorage.getItem('lastCPF');
        const lastRegisteredCPF = localStorage.getItem('lastRegisteredCPF');

        if (lastCPF || lastRegisteredCPF) {
            cpfInput.value = lastCPF || lastRegisteredCPF;
            localStorage.removeItem('lastCPF');
            localStorage.removeItem('lastRegisteredCPF');
        }

        cpfInput.addEventListener('input', function(e) {
            let v = e.target.value.replace(/\D/g, "");
            if (v.length > 11) v = v.slice(0, 11);

            v = v.replace(/(\d{3})(\d)/, "$1.$2");
            v = v.replace(/(\d{3})(\d)/, "$1.$2");
            v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");

            e.target.value = v;
        });
    }

    // Máscara no input do modal também
    const forgotEmailInput = document.getElementById('forgotEmail');
    if (forgotEmailInput) {
        forgotEmailInput.addEventListener('input', function(e) {
            let v = e.target.value.replace(/\D/g, "");
            if (v.length > 11) v = v.slice(0, 11);

            v = v.replace(/(\d{3})(\d)/, "$1.$2");
            v = v.replace(/(\d{3})(\d)/, "$1.$2");
            v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");

            e.target.value = v;
        });
    }
});

// Login Form com Feedback Visual e Redirecionamento
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginFormPaciente');
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const btn = e.target.querySelector('.btn-login');
            const originalText = btn.innerText;

            // 1. Validação básica de segurança
            const cpf = document.getElementById('cpf').value;
            const password = document.getElementById('password').value;

            if (cpf.length < 11 || password.length < 8) {
                showPopup("Por favor, informe um CPF e uma senha com no mínimo 8 caracteres.");
                return;
            }

            // 2. Efeito de "Carregando" no botão (Estilo Moderno)
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Acessando...';
            btn.style.opacity = "0.8";
            btn.style.cursor = "not-allowed";

            const cpfDigits = cpf.replace(/\D/g, '');
            const result = await loginPacienteAPI(cpfDigits, password);

            if (result.ok) {
                // Salvar token e dados
                localStorage.setItem('token', result.data.token);
                localStorage.setItem('user', JSON.stringify(result.data.user));
                localStorage.setItem('patientCPF', cpfDigits);

                // Redireciona para a tela
                setTimeout(() => {
                    window.location.href = "dash-paciente.html";
                }, 800);
            } else {
                showPopup(result.data.message || "CPF ou senha incorretos.");
                btn.innerHTML = originalText;
                btn.disabled = false;
                btn.style.opacity = "";
                btn.style.cursor = "";
            }
        });
    }
});

// Adicione este CSS via JS apenas para a animação do ícone de carregar
const style = document.createElement('style');
style.innerHTML = `
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);
