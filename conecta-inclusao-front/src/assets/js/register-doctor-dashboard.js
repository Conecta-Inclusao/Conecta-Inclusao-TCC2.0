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
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 2rem;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    `;

    content.innerHTML = `
        <div style="text-align: center; margin-bottom: 1.5rem;">
            <i class="ph ph-check-circle" style="font-size: 3rem; color: #27ae60;"></i>
            <h2 style="color: #333; margin-top: 1rem;">Medico Cadastrado com Sucesso!</h2>
        </div>

        <div style="background-color: #e8f4f8; border-left: 4px solid #3498db; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
            <p style="color: #2c3e50; margin: 0; font-size: 0.95rem;">
                <strong>Importante:</strong> Compartilhe as credenciais abaixo com o medico. Ele devera alterar a senha no primeiro login.
            </p>
        </div>

        <div style="background-color: #f5f5f5; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
            <div style="margin-bottom: 1.5rem;">
                <label style="display: block; font-weight: 600; color: #333; margin-bottom: 0.5rem;">CRM:</label>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <input type="text" value="${credentials.identifier}" readonly style="flex: 1; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-family: monospace; font-size: 1rem;">
                    <button onclick="copyToClipboard('${credentials.identifier}')" style="padding: 0.75rem 1rem; background-color: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer;">
                        <i class="ph ph-copy"></i> Copiar
                    </button>
                </div>
            </div>

            <div style="margin-bottom: 1.5rem;">
                <label style="display: block; font-weight: 600; color: #333; margin-bottom: 0.5rem;">Senha Temporaria:</label>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <input type="text" value="${credentials.password}" readonly style="flex: 1; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-family: monospace; font-size: 1rem;">
                    <button onclick="copyToClipboard('${credentials.password}')" style="padding: 0.75rem 1rem; background-color: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer;">
                        <i class="ph ph-copy"></i> Copiar
                    </button>
                </div>
            </div>

            <div>
                <label style="display: block; font-weight: 600; color: #333; margin-bottom: 0.5rem;">Nome Medico:</label>
                <p style="margin: 0; padding: 0.75rem; background-color: white; border-radius: 6px; border: 1px solid #ddd;">${credentials.name}</p>
            </div>
        </div>

        <div style="display: flex; gap: 1rem;">
            <button onclick="this.closest('div').parentElement.parentElement.remove();" style="flex: 1; padding: 0.75rem 1.5rem; background-color: #27ae60; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">
                Fechar
            </button>
            <button onclick="printCredentials('${credentials.identifier}', '${credentials.password}', '${credentials.name}')" style="flex: 1; padding: 0.75rem 1.5rem; background-color: #3498db; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">
                <i class="ph ph-printer"></i> Imprimir
            </button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
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
