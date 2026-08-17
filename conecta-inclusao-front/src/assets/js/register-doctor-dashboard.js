async function getClinicDetails() {
    const token = window.ConectaSession.getToken();

    if (!token) {
        return { ok: false, message: 'Token nao encontrado' };
    }

    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/clinic/details`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const result = await response.json();
        return { ok: response.ok, data: result, status: response.status };
    } catch (error) {
        console.error('Erro na requisicao:', error);
        return { ok: false, message: 'Erro de conexao com o servidor' };
    }
}

async function registerDoctorFromDashboard(data) {
    const token = window.ConectaSession.getToken();

    if (!token) {
        showPopup('Voce precisa estar autenticado para cadastrar um medico.');
        window.location.href = 'login-empresa.html';
        return { ok: false };
    }

    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/register/professional`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        return { ok: response.ok, data: result, status: response.status };
    } catch (error) {
        console.error('Erro na requisicao:', error);
        return { ok: false, data: { message: 'Erro de conexao com o servidor' } };
    }
}

function showCredentialsModal(credentials) {
    // Este modal era 70 linhas de `style="..."` inline com uma paleta propria
    // (#3498db, #27ae60) que nao existia em nenhum outro lugar do sistema - e,
    // por ser inline, ignorava o tema de alto contraste. Agora usa as mesmas
    // classes dos demais modais; o estilo esta em dashboard-empresa.css.
    const modal = document.createElement('div');
    modal.className = 'modal credentials-modal active';

    const content = document.createElement('div');
    content.className = 'modal-content';

    content.innerHTML = `
        <div class="credentials-head">
            <i class="ph ph-check-circle" aria-hidden="true"></i>
            <h2>Profissional cadastrado com sucesso</h2>
        </div>

        <p class="credentials-note">
            <strong>Importante:</strong> compartilhe as credenciais abaixo com o profissional.
            Ele devera alterar a senha no primeiro acesso.
        </p>

        <div class="credentials-box">
            <div class="credentials-field">
                <label for="credentialsRegistry">Registro (login)</label>
                <div class="credentials-row">
                    <input type="text" id="credentialsRegistry" value="${credentials.identifier}" readonly>
                    <button type="button" class="btn-secondary" data-copy="identifier">
                        <i class="ph ph-copy" aria-hidden="true"></i> Copiar
                    </button>
                </div>
            </div>

            <div class="credentials-field">
                <label for="credentialsPassword">Senha temporaria</label>
                <div class="credentials-row">
                    <input type="text" id="credentialsPassword" value="${credentials.password}" readonly>
                    <button type="button" class="btn-secondary" data-copy="password">
                        <i class="ph ph-copy" aria-hidden="true"></i> Copiar
                    </button>
                </div>
            </div>

            <div class="credentials-field">
                <label for="credentialsName">Nome do profissional</label>
                <input type="text" id="credentialsName" value="${credentials.name}" readonly>
            </div>
        </div>

        <div class="modal-footer">
            <button type="button" class="btn-secondary" data-action="print">
                <i class="ph ph-printer" aria-hidden="true"></i> Imprimir
            </button>
            <button type="button" class="btn-primary" data-action="close">Fechar</button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    content.querySelectorAll('[data-copy]').forEach((button) => {
        button.addEventListener('click', () => copyToClipboard(credentials[button.dataset.copy]));
    });

    content.querySelector('[data-action="print"]').addEventListener('click', () => {
        printCredentials(credentials.identifier, credentials.password, credentials.name);
    });

    const close = () => modal.remove();
    content.querySelector('[data-action="close"]').addEventListener('click', close);
    content.querySelector('[data-action="close"]').focus();

    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });

    document.addEventListener('keydown', function onEscape(event) {
        if (event.key !== 'Escape') return;
        document.removeEventListener('keydown', onEscape);
        close();
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showPopup('Copiado para a area de transferencia!');
    }).catch(() => {
        alert('Erro ao copiar: ' + text);
    });
}

function printCredentials(crm, password, name) {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Credenciais do Medico</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 2rem; }
                    .header { text-align: center; margin-bottom: 2rem; }
                    .content { max-width: 500px; margin: 0 auto; }
                    .field { margin-bottom: 1.5rem; }
                    label { display: block; font-weight: bold; margin-bottom: 0.5rem; }
                    .value { padding: 0.75rem; background-color: #f5f5f5; border-radius: 6px; }
                    .warning { background-color: #fff3cd; padding: 1rem; border-radius: 6px; margin-bottom: 1rem; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Credenciais de Acesso - Conecta Inclusao</h1>
                </div>
                <div class="content">
                    <div class="warning">
                        <strong>IMPORTANTE:</strong> Guarde estas credenciais com seguranca. O medico deve alterar a senha no primeiro login.
                    </div>
                    <div class="field">
                        <label>Nome do Medico:</label>
                        <div class="value">${name}</div>
                    </div>
                    <div class="field">
                        <label>CRM (Identificador de Login):</label>
                        <div class="value">${crm}</div>
                    </div>
                    <div class="field">
                        <label>Senha Temporaria:</label>
                        <div class="value">${password}</div>
                    </div>
                </div>
            </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('registerDoctorForm');
    if (!form) return;

    getClinicDetails().then((result) => {
        if (!result.ok || !result.data) return;

        if (result.data.cnpj) {
            sessionStorage.setItem('empresaCnpj', result.data.cnpj);
        }
        if (result.data.razao_social) {
            sessionStorage.setItem('empresaRazaoSocial', result.data.razao_social);
        }
    }).catch((error) => {
        console.error('Erro ao carregar dados da clinica:', error);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const crm = document.getElementById('docCRM').value.trim().toUpperCase();
        const name = document.getElementById('docName').value.trim();
        const especialidade = document.getElementById('docEspecialidade').value.trim();
        const email = document.getElementById('docEmail').value.trim();
        const unit = document.getElementById('docUnit').value;
        const password = document.getElementById('docPassword').value;
        const confirmPassword = document.getElementById('docConfirmPassword').value;
        const bio = document.getElementById('docBio').value.trim();

        if (!crm || !name || !especialidade || !unit || !password || !confirmPassword) {
            showPopup('Preencha todos os campos obrigatorios.');
            return;
        }

        if (crm.length < 4 || crm.length > 7) {
            showPopup('CRM deve ter entre 4 e 7 caracteres.');
            return;
        }

        if (!isStrongPassword(password)) {
            showPopup('A senha deve ter 8 caracteres, maiúscula, minúscula, número e caractere especial.');
            return;
        }

        if (password !== confirmPassword) {
            showPopup('As senhas nao coincidem.');
            return;
        }

        const userStr = window.ConectaSession.getToken()
            ? JSON.stringify(window.ConectaSession.getUser())
            : null;
        if (!userStr) {
            showPopup('Voce precisa estar autenticado.');
            window.location.href = 'login-empresa.html';
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerText;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Cadastrando...';

        const registrationData = {
            crm,
            name,
            especialidade,
            unidade: unit,
            password,
            email: email || null,
            bio: bio || null
        };

        const result = await registerDoctorFromDashboard(registrationData);

        if (result.ok && result.data?.data) {
            const credentials = result.data.data;

            showPopup('Medico cadastrado com sucesso!');

            if (window.companyDashboard?.addOrUpdateProfessional) {
                window.companyDashboard.addOrUpdateProfessional({
                    name,
                    role: especialidade,
                    registry: credentials.crm,
                    status: 'Ativo',
                    unit,
                    email: email || '',
                    bio: bio || ''
                });
            }

            // A senha exibida e a que a clinica acabou de digitar neste
            // formulario. A API deixou de devolve-la no corpo da resposta -
            // ecoar senha em texto claro deixa rastro em log de proxy.
            showCredentialsModal({
                identifier: credentials.crm,
                password,
                name: credentials.name
            });

            form.reset();
        } else {
            const errorMsg = result.data?.message || 'Erro ao cadastrar medico.';
            showPopup(errorMsg);
        }

        submitBtn.disabled = false;
        submitBtn.innerText = originalText;
    });

    const crmInput = document.getElementById('docCRM');
    if (crmInput) {
        crmInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
        });
    }

    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});
