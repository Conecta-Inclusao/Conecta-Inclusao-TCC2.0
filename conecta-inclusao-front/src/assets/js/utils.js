function showPopup(message, type = 'info') {
    return new Promise((resolve) => {
        if (window.__activePopupState?.modal?.parentNode) {
            window.__activePopupState.modal.parentNode.removeChild(window.__activePopupState.modal);
            window.__activePopupState.resolve(window.__activePopupState.type === 'confirm' ? false : undefined);
        }

        const modal = document.createElement('div');
        modal.className = 'popup-modal';
        document.body.appendChild(modal);

        const cleanup = (result) => {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }

            if (window.__activePopupState?.modal === modal) {
                window.__activePopupState = null;
            }

            resolve(result);
        };

        window.__activePopupState = {
            modal,
            resolve,
            type
        };

        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
        modal.style.display = 'flex';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.zIndex = '3000';

        const content = document.createElement('div');
        content.className = 'popup-content';
        content.style.backgroundColor = 'white';
        content.style.padding = '20px';
        content.style.borderRadius = '8px';
        content.style.textAlign = 'center';
        content.style.maxWidth = '400px';
        modal.appendChild(content);

        const p = document.createElement('p');
        p.textContent = message;
        content.appendChild(p);

        if (type === 'confirm') {
            const yesBtn = document.createElement('button');
            yesBtn.className = 'popup-yes';
            yesBtn.textContent = 'Sim';
            yesBtn.style.marginTop = '10px';
            yesBtn.style.marginRight = '10px';
            yesBtn.style.padding = '10px 20px';
            yesBtn.style.border = 'none';
            yesBtn.style.backgroundColor = '#007bff';
            yesBtn.style.color = 'white';
            yesBtn.style.borderRadius = '4px';
            yesBtn.style.cursor = 'pointer';
            content.appendChild(yesBtn);

            const noBtn = document.createElement('button');
            noBtn.className = 'popup-no';
            noBtn.textContent = 'Não';
            noBtn.style.marginTop = '10px';
            noBtn.style.padding = '10px 20px';
            noBtn.style.border = 'none';
            noBtn.style.backgroundColor = '#6c757d';
            noBtn.style.color = 'white';
            noBtn.style.borderRadius = '4px';
            noBtn.style.cursor = 'pointer';
            content.appendChild(noBtn);

            yesBtn.addEventListener('click', () => cleanup(true));

            noBtn.addEventListener('click', () => cleanup(false));
        } else {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'popup-close';
            closeBtn.textContent = 'OK';
            closeBtn.style.marginTop = '10px';
            closeBtn.style.padding = '10px 20px';
            closeBtn.style.border = 'none';
            closeBtn.style.backgroundColor = '#007bff';
            closeBtn.style.color = 'white';
            closeBtn.style.borderRadius = '4px';
            closeBtn.style.cursor = 'pointer';
            content.appendChild(closeBtn);

            closeBtn.addEventListener('click', () => cleanup());
        }
    });
}

function setupPasswordVisibilityToggles() {
    const passwordInputs = document.querySelectorAll('input[type="password"], input[data-password-toggle="true"]');

    if (!passwordInputs.length) return;

    if (!document.getElementById('passwordVisibilityStyles')) {
        const style = document.createElement('style');
        style.id = 'passwordVisibilityStyles';
        style.textContent = `
            .password-visibility-field {
                position: relative;
                display: flex;
                align-items: center;
                width: 100%;
            }

            .password-visibility-field input {
                width: 100%;
                padding-right: 3rem !important;
            }

            .password-visibility-toggle {
                position: absolute;
                right: 0.75rem;
                top: 50%;
                transform: translateY(-50%);
                width: 2rem;
                height: 2rem;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border: 0;
                border-radius: 6px;
                background: transparent;
                color: #64748b;
                cursor: pointer;
                z-index: 2;
            }

            .password-visibility-toggle:hover,
            .password-visibility-toggle:focus-visible {
                color: #0073e6;
                background: rgba(0, 115, 230, 0.08);
                outline: none;
            }

            .password-visibility-toggle i {
                font-size: 1.15rem;
                line-height: 1;
            }

            .password-rule-feedback {
                margin-top: 0.6rem;
                padding: 0.65rem 0.8rem;
                border: 1.5px solid #e2e8f0;
                border-radius: 0.6rem;
                background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                color: #334155;
                font-size: 0.8rem;
                line-height: 1.3;
                width: 100% !important;
                box-sizing: border-box !important;
                display: block !important;
                opacity: 1;
                transform: translateY(0);
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                flex-shrink: 0;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
            }

            .password-guidance-row {
                width: 100%;
                grid-column: 1 / -1;
                margin-top: -0.25rem;
            }

            .password-guidance-row .password-rule-feedback {
                margin-top: 0;
            }

            .password-rule-feedback.show {
                display: block !important;
                opacity: 1;
                transform: translateY(0);
            }

            .password-rule-feedback p {
                margin: 0 0 0.5rem;
                font-weight: 700;
                color: #0f172a;
                font-size: 0.75rem;
                display: flex;
                align-items: center;
                gap: 0.4rem;
                text-transform: uppercase;
                letter-spacing: 0.3px;
            }

            .password-rule-feedback p i {
                font-size: 0.9rem;
                color: #0073e6;
            }

            .password-rule-feedback ul {
                list-style: none;
                margin: 0;
                padding: 0;
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 0.5rem;
            }

            .password-rule-feedback li {
                margin: 0;
                display: flex;
                align-items: center;
                gap: 0.35rem;
                font-size: 0.75rem;
                color: #64748b;
                padding: 0.3rem 0.5rem;
                border-radius: 0.4rem;
                background: rgba(255, 255, 255, 0.6);
                transition: all 0.2s ease-in-out;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .password-rule-feedback li i {
                font-size: 0.85rem;
                color: #cbd5e1;
                transition: color 0.2s ease-in-out;
                flex-shrink: 0;
            }

            .password-rule-feedback li.valid {
                color: #15803d;
                background: rgba(34, 197, 94, 0.1);
            }

            .password-rule-feedback li.valid i {
                color: #22c55e;
            }

            @media (max-width: 768px) {
                .password-rule-feedback ul {
                    grid-template-columns: 1fr 1fr;
                }

                .password-rule-feedback {
                    margin-top: 0.5rem;
                    padding: 0.55rem 0.7rem;
                }

                .password-rule-feedback p {
                    font-size: 0.7rem;
                    gap: 0.3rem;
                }

                .password-rule-feedback li {
                    font-size: 0.7rem;
                    padding: 0.25rem 0.4rem;
                }
            }

            @media (max-width: 480px) {
                .password-rule-feedback ul {
                    grid-template-columns: 1fr;
                }

                .password-rule-feedback {
                    margin-top: 0.4rem;
                    padding: 0.5rem 0.6rem;
                }

                .password-rule-feedback p {
                    font-size: 0.65rem;
                    margin-bottom: 0.4rem;
                }

                .password-rule-feedback li {
                    font-size: 0.65rem;
                    padding: 0.2rem 0.35rem;
                    gap: 0.25rem;
                }
            }
        `;
        document.head.appendChild(style);
    }

    passwordInputs.forEach((input) => {
        if (input.dataset.passwordToggleReady === 'true') return;
        if (input.closest('.password-input-group')?.querySelector('.toggle-password')) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'password-visibility-field';
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);

        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'password-visibility-toggle';
        toggleButton.setAttribute('aria-label', 'Mostrar senha');
        toggleButton.setAttribute('title', 'Mostrar senha');
        toggleButton.innerHTML = '<i class="ph ph-eye"></i>';

        toggleButton.addEventListener('click', () => {
            const showingPassword = input.type === 'text';
            input.type = showingPassword ? 'password' : 'text';
            input.dataset.passwordToggle = 'true';
            toggleButton.setAttribute('aria-label', showingPassword ? 'Mostrar senha' : 'Ocultar senha');
            toggleButton.setAttribute('title', showingPassword ? 'Mostrar senha' : 'Ocultar senha');
            toggleButton.innerHTML = showingPassword ? '<i class="ph ph-eye"></i>' : '<i class="ph ph-eye-slash"></i>';
        });

        wrapper.appendChild(toggleButton);
        input.dataset.passwordToggleReady = 'true';
    });
}

function getPasswordRules() {
    return [
        { test: (password) => password.length >= 8, label: 'Mínimo de 8 caracteres' },
        { test: (password) => /[a-z]/.test(password), label: 'Uma letra minúscula' },
        { test: (password) => /[A-Z]/.test(password), label: 'Uma letra maiúscula' },
        { test: (password) => /\d/.test(password), label: 'Um número' },
        { test: (password) => /[^A-Za-z0-9]/.test(password), label: 'Um caractere especial' }
    ];
}

function isStrongPassword(password) {
    return getPasswordRules().every(rule => rule.test(password || ''));
}

function updatePasswordFeedback(input) {
    const value = input.value || '';
    const feedbackId = input.dataset.passwordFeedbackId;
    const feedback = feedbackId
        ? document.getElementById(feedbackId)
        : input.parentNode.querySelector('.password-rule-feedback');
    if (!feedback) return;

    const listItems = feedback.querySelectorAll('li');
    getPasswordRules().forEach((rule, index) => {
        const item = listItems[index];
        if (!item) return;
        const isValid = rule.test(value);
        item.classList.toggle('valid', isValid);
        const icon = item.querySelector('i');
        if (isValid) {
            icon.className = 'ph ph-check-circle';
        } else {
            icon.className = 'ph ph-circle';
        }
    });
}

function refreshPasswordFeedback(root = document) {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    scope.querySelectorAll('input[data-password-guidance="true"]').forEach((input) => {
        updatePasswordFeedback(input);
    });
}

function setupPasswordRuleFeedback() {
    const passwordInputs = document.querySelectorAll('input[type="password"][data-password-guidance="true"]');

    passwordInputs.forEach((input) => {
        if (input.dataset.passwordGuidanceReady === 'true') return;
        const form = input.closest('form');
        const fieldGroup = input.closest('.form-group, .input-group') || input.parentNode;
        const confirmInput = form
            ? Array.from(form.querySelectorAll('input[type="password"]')).find((candidate) => {
                if (candidate === input) return false;
                const candidateId = (candidate.id || '').toLowerCase();
                const candidateName = (candidate.name || '').toLowerCase();
                return candidateId.includes('confirm') || candidateName.includes('confirm');
            })
            : null;
        const confirmGroup = confirmInput?.closest('.form-group, .input-group') || confirmInput?.parentNode;
        const sharedLayout = fieldGroup?.parentElement === confirmGroup?.parentElement
            ? fieldGroup.parentElement
            : null;
        const feedbackId = `password-rule-feedback-${Math.random().toString(36).slice(2)}`;

        const feedbackWrapper = document.createElement('div');
        feedbackWrapper.className = 'password-guidance-row';

        const feedback = document.createElement('div');
        feedback.className = 'password-rule-feedback';
        feedback.id = feedbackId;
        feedback.innerHTML = `
            <p><i class="ph ph-lock"></i> Requisitos de senha segura</p>
            <ul>${getPasswordRules().map(rule => `<li><i class="ph ph-circle"></i> ${rule.label}</li>`).join('')}</ul>
        `;
        feedbackWrapper.appendChild(feedback);

        if (sharedLayout && confirmGroup) {
            sharedLayout.insertBefore(feedbackWrapper, confirmGroup.nextSibling);
        } else if (confirmGroup?.parentNode) {
            confirmGroup.parentNode.insertBefore(feedbackWrapper, confirmGroup.nextSibling);
        } else if (fieldGroup?.parentNode) {
            fieldGroup.parentNode.insertBefore(feedbackWrapper, fieldGroup.nextSibling);
        } else {
            input.parentNode.appendChild(feedbackWrapper);
        }

        input.dataset.passwordFeedbackId = feedbackId;
        input.addEventListener('input', () => updatePasswordFeedback(input));
        input.addEventListener('change', () => updatePasswordFeedback(input));
        if (form && form.dataset.passwordFeedbackResetReady !== 'true') {
            form.addEventListener('reset', () => {
                setTimeout(() => refreshPasswordFeedback(form), 0);
            });
            form.dataset.passwordFeedbackResetReady = 'true';
        }
        updatePasswordFeedback(input);
        input.dataset.passwordGuidanceReady = 'true';
    });
}

function preventPasswordCopyPaste(input) {
    ['paste', 'copy', 'cut', 'drop', 'contextmenu'].forEach((eventName) => {
        input.addEventListener(eventName, (event) => {
            event.preventDefault();
            event.stopPropagation();
            return false;
        });
    });
}

function setupProtectedPasswordInputs() {
    document.querySelectorAll('input[type="password"]').forEach((input) => {
        if (input.dataset.passwordProtectionReady === 'true') return;
        preventPasswordCopyPaste(input);
        input.dataset.passwordProtectionReady = 'true';
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setupPasswordVisibilityToggles();
        setupProtectedPasswordInputs();
        setupPasswordRuleFeedback();
    });
} else {
    setupPasswordVisibilityToggles();
    setupProtectedPasswordInputs();
    setupPasswordRuleFeedback();
}

// Função para validar CPF
function validarCPF(cpf) {
    // Remove caracteres não numéricos
    cpf = cpf.replace(/[^\d]/g, '');

    // Verifica se tem 11 dígitos
    if (cpf.length !== 11) {
        return false;
    }

    // Verifica se todos os dígitos são iguais (CPF inválido)
    if (/^(\d)\1+$/.test(cpf)) {
        return false;
    }

    // Calcula o primeiro dígito verificador
    let soma = 0;
    for (let i = 0; i < 9; i++) {
        soma += parseInt(cpf.charAt(i)) * (10 - i);
    }
    let resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(9))) {
        return false;
    }

    // Calcula o segundo dígito verificador
    soma = 0;
    for (let i = 0; i < 10; i++) {
        soma += parseInt(cpf.charAt(i)) * (11 - i);
    }
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(10))) {
        return false;
    }

    return true;
}
