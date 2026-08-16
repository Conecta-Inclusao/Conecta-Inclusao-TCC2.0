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
    const normalizedIdentifier = identifier.replace(/[\s-]/g, '').replace(/^CRM/i, '').toUpperCase();

    if (!normalizedIdentifier || normalizedIdentifier.length < 4) {
        showPopup("Por favor, digite um Registro válido.");
        return;
    }

    const btn = document.querySelector('#forgotPasswordModal .forgot-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Enviando...';

    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/password/forgot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, identifier: normalizedIdentifier })
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

function formatRegistry(value) {
    let v = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.startsWith('CRM')) {
        v = v.replace(/^CRM/, 'CRM ');
        v = v.replace(/(\d{6})(\d{1,2})$/, '$1-$2');
    } else if (v.startsWith('COREN')) {
        v = v.replace(/^COREN/, 'COREN ');
    } else if (v.startsWith('CREFITO')) {
        v = v.replace(/^CREFITO/, 'CREFITO ');
    }
    return v;
}

async function loginMedicoAPI(identifier, password) {
    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/login/universal`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ identifier, password, expectedProfile: 'medico' })
        });
        const result = await response.json();
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('Erro na requisição:', error);
        return { ok: false, data: { message: 'Erro de conexão' } };
    }
}

async function resetTemporaryPasswordAPI(resetToken, newPassword) {
    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/professional/reset-temporary-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ resetToken, newPassword })
        });
        const result = await response.json();
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('Erro na redefinição de senha:', error);
        return { ok: false, data: { message: 'Erro de conexão' } };
    }
}

function validateStrongPassword(password) {
    const rules = [
        { valid: password.length >= 8, message: 'mínimo de 8 caracteres' },
        { valid: /[a-z]/.test(password), message: 'uma letra minúscula' },
        { valid: /[A-Z]/.test(password), message: 'uma letra maiúscula' },
        { valid: /\d/.test(password), message: 'um número' },
        { valid: /[^A-Za-z0-9]/.test(password), message: 'um caractere especial' }
    ];

    const missingRules = rules.filter(rule => !rule.valid).map(rule => rule.message);
    return {
        valid: missingRules.length === 0,
        message: missingRules.length ? `A senha deve conter ${missingRules.join(', ')}.` : ''
    };
}

function saveProfessionalSession(data, registryFallback) {
    window.ConectaSession.saveSession(data.token, data.user);

    const user = data.user || {};
    const registeredRegistry = user.registry || user.crm || registryFallback;
    const registeredUnit = user.unidade || user.unit || 'Unidade não definida';

    sessionStorage.setItem('professionalName', user.name || 'Nome cadastrado');
    sessionStorage.setItem('professionalRegistry', registeredRegistry);
    sessionStorage.setItem('professionalUnit', registeredUnit);
}

function redirectToDoctorDashboard() {
    showPopup("Acesso autorizado! Redirecionando para o painel...");
    setTimeout(() => {
        window.location.href = "dashboard-medico.html";
    }, 800);
}

function showTemporaryPasswordModal(resetToken, registryFallback, loginButton) {
    const existingModal = document.getElementById('temporaryPasswordModal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'temporaryPasswordModal';
    modal.className = 'temporary-password-overlay';
    modal.innerHTML = `
        <div class="temporary-password-card">
            <div class="temporary-password-header">
                <i class="ph ph-lock-key"></i>
                <h2>Redefinir senha</h2>
                <p>Esta é sua primeira entrada com senha temporária. Crie uma senha segura para continuar.</p>
            </div>
            <form id="temporaryPasswordForm">
                <div class="input-group">
                    <label for="newProfessionalPassword">Nova senha</label>
                    <input type="password" id="newProfessionalPassword" data-password-guidance="true" placeholder="Nova senha segura" required>
                </div>
                <div class="input-group">
                    <label for="confirmProfessionalPassword">Confirmar nova senha</label>
                    <input type="password" id="confirmProfessionalPassword" placeholder="Repita a nova senha" required>
                </div>
                <ul class="password-rules">
                    <li>Mínimo de 8 caracteres</li>
                    <li>Letra maiúscula e minúscula</li>
                    <li>Número e caractere especial</li>
                    <li>Diferente da senha temporária</li>
                </ul>
                <p id="temporaryPasswordError" class="temporary-password-error"></p>
                <button type="submit" class="btn-login">Salvar nova senha</button>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    if (typeof setupPasswordVisibilityToggles === 'function') {
        setupPasswordVisibilityToggles();
    }
    if (typeof setupProtectedPasswordInputs === 'function') {
        setupProtectedPasswordInputs();
    }
    if (typeof setupPasswordRuleFeedback === 'function') {
        setupPasswordRuleFeedback();
    }

    const form = document.getElementById('temporaryPasswordForm');
    const errorEl = document.getElementById('temporaryPasswordError');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const newPassword = document.getElementById('newProfessionalPassword').value;
        const confirmPassword = document.getElementById('confirmProfessionalPassword').value;
        const submitButton = form.querySelector('button[type="submit"]');

        errorEl.textContent = '';

        const passwordValidation = validateStrongPassword(newPassword);
        if (!passwordValidation.valid) {
            errorEl.textContent = passwordValidation.message;
            return;
        }

        if (newPassword !== confirmPassword) {
            errorEl.textContent = 'As senhas não coincidem.';
            return;
        }

        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Salvando...';

        const result = await resetTemporaryPasswordAPI(resetToken, newPassword);

        if (result.ok) {
            saveProfessionalSession(result.data, registryFallback);
            modal.remove();
            redirectToDoctorDashboard();
            return;
        }

        errorEl.textContent = result.data.message || 'Erro ao redefinir senha.';
        submitButton.disabled = false;
        submitButton.innerText = 'Salvar nova senha';

        if (loginButton) {
            loginButton.innerHTML = 'Acessar como Médico';
            loginButton.style.opacity = '';
            loginButton.disabled = false;
        }
    });
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

    // Máscara para o registro
    const registryInput = document.getElementById('crm');
    if (registryInput) {
        // Pré-preencher CRM se vindo do cadastro
        const lastCRM = localStorage.getItem('lastCRM');
        if (lastCRM) {
            registryInput.value = lastCRM;
            localStorage.removeItem('lastCRM'); // Limpar após usar
            localStorage.removeItem('lastRegisteredCRM');
        }
        
        registryInput.addEventListener('input', function(e) {
            e.target.value = formatRegistry(e.target.value);
        });
    }
});

// CSS para animação
const style = document.createElement('style');
style.innerHTML = `
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .temporary-password-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.62);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        z-index: 4000;
    }

    .temporary-password-card {
        width: min(100%, 460px);
        background: #ffffff;
        border-radius: 18px;
        padding: 28px;
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
    }

    .temporary-password-header {
        text-align: center;
        margin-bottom: 22px;
    }

    .temporary-password-header i {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 54px;
        height: 54px;
        border-radius: 50%;
        background: #eef4ff;
        color: #0073e6;
        font-size: 28px;
        margin-bottom: 14px;
    }

    .temporary-password-header h2 {
        color: #1f2937;
        margin-bottom: 8px;
    }

    .temporary-password-header p,
    .password-rules {
        color: #64748b;
        font-size: 14px;
        line-height: 1.5;
    }

    .password-rules {
        margin: 12px 0 4px 18px;
    }

    .temporary-password-error {
        min-height: 20px;
        color: #dc2626;
        font-size: 14px;
        margin: 10px 0;
    }
`;
document.head.appendChild(style);

// Form de login
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async function(event) {
            event.preventDefault();

            const registry = document.getElementById('crm').value.trim();
            const password = document.getElementById('password').value;

            if (!registry || !password) {
                showPopup('Por favor, preencha o registro e a senha.');
                return;
            }

            const registryNormalized = registry.replace(/[\s-]/g, '').toUpperCase();

            if (/^\d{11}$/.test(registryNormalized)) {
                showPopup('Login de profissional deve ser feito somente com o CRM cadastrado pela empresa.');
                return;
            }

            // Efeito visual no botão
            const btn = document.querySelector('.btn-login');
            btn.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Autenticando...';
            btn.style.opacity = "0.7";
            btn.disabled = true;

            const result = await loginMedicoAPI(registryNormalized, password);

            if (result.ok) {
                if (result.data.user?.profile !== 'medico') {
                    showPopup('Login de profissional deve ser feito somente com o CRM cadastrado pela empresa.');
                    btn.innerHTML = 'Acessar como MÃ©dico';
                    btn.style.opacity = "";
                    btn.disabled = false;
                    return;
                }

                if (result.data.requiresPasswordReset) {
                    showTemporaryPasswordModal(result.data.resetToken, registryNormalized, btn);
                    return;
                }

                saveProfessionalSession(result.data, registryNormalized);
                redirectToDoctorDashboard();
            } else {
                showPopup(result.data.message || "Registro ou senha incorretos.");
                btn.innerHTML = 'Acessar como Médico';
                btn.style.opacity = "";
                btn.disabled = false;
            }
        });
    }
});
