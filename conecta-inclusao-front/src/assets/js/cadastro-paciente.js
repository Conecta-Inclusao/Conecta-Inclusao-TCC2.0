let guardianData = null;
let availablePermissions = null;
const API = 'https://conecta-inclusao.onrender.com'; 

function refreshGuardianPasswordFeedback() {
    const guardianPassword = document.getElementById('guardianPassword');
    if (!guardianPassword) return;

    if (typeof updatePasswordFeedback === 'function') {
        updatePasswordFeedback(guardianPassword);
    } else {
        guardianPassword.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function applyMask(input, maskFn) {
    input.addEventListener('input', function(event) {
        event.target.value = maskFn(event.target.value);
    });
}

function cpfMask(value) {
    let v = value.replace(/\D/g, '');
    if (v.length > 11) v = v.slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    return v;
}

function calculateAge(dateString) {
    if (!dateString) return null;
    const birth = new Date(dateString);
    if (isNaN(birth.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    const dayDiff = today.getDate() - birth.getDate();

    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
        age -= 1;
    }

    return age;
}

function updateGuardianSummary() {
    const summaryText = document.getElementById('guardianSummaryText');
    const hiddenName = document.getElementById('nomeResponsavel');

    if (!guardianData) {
        summaryText.textContent = 'Nenhum responsÃ¡vel adicionado.';
        hiddenName.value = '';
        return;
    }

    const parts = [guardianData.name];
    if (guardianData.parentesco) parts.push(`(${guardianData.parentesco})`);
    if (guardianData.email) parts.push(guardianData.email);
    if (guardianData.permissoes && guardianData.permissoes.length) {
        parts.push(`PermissÃµes: ${guardianData.permissoes.join(', ')}`);
    }
    summaryText.textContent = parts.join(' ');
    hiddenName.value = guardianData.name;
}

async function fetchAvailablePermissions() {
    try {
        const response = await fetch(`${API}/auth/permissions`);
        const result = await response.json();
        if (response.ok && Array.isArray(result.permissions)) {
            availablePermissions = result.permissions;
        } else {
            availablePermissions = [];
            console.error('Falha ao buscar permissÃµes:', result.message || response.statusText);
        }
    } catch (error) {
        availablePermissions = [];
        console.error('Erro ao buscar permissÃµes:', error);
    }

    renderGuardianPermissions();
}

function renderGuardianPermissions() {
    const container = document.getElementById('guardianPermissionsContainer');
    if (!container) return;

    if (availablePermissions === null) {
        container.innerHTML = '<p>Carregando permissÃµes...</p>';
        return;
    }

    if (!availablePermissions.length) {
        container.innerHTML = '<p>NÃ£o foi possÃ­vel carregar as permissÃµes. Tente novamente mais tarde.</p>';
        return;
    }

    const currentPermissions = guardianData?.permissoes || [];
    container.innerHTML = availablePermissions.map(permission => {
        const checked = currentPermissions.includes(permission.key) ? 'checked' : '';
        return `
            <label class="permission-option" style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                <input type="checkbox" name="guardianPermissions" value="${permission.key}" ${checked}>
                <span>${permission.label}</span>
            </label>
        `;
    }).join('');
}

function getSelectedGuardianPermissions() {
    return Array.from(document.querySelectorAll('input[name="guardianPermissions"]:checked')).map(input => input.value);
}


function updateGuardianSection() {
    const birthDate = document.getElementById('dataNascimento').value;
    const age = calculateAge(birthDate);
    const guardianAdvice = document.getElementById('guardianAdvice');
    const guardianSummary = document.getElementById('guardianSummary');

    const openModalBtn = document.getElementById('openGuardianModalButton');

    if (age !== null && age < 18) {
        guardianAdvice.textContent = 'Paciente menor de idade exige responsÃ¡vel. Preencha os dados do responsÃ¡vel.';
        guardianSummary.style.display = 'block';
        if (openModalBtn) openModalBtn.innerText = 'Adicionar responsÃ¡vel';
    } else if (age !== null && age >= 18) {
        guardianAdvice.textContent = 'Paciente maior de idade. Adicionar responsÃ¡vel Ã© opcional.';
        guardianSummary.style.display = 'block';
        if (openModalBtn) openModalBtn.innerText = 'Adicionar responsÃ¡vel (opcional)';
    } else {
        guardianAdvice.textContent = 'Preencha a data de nascimento para verificar se responsÃ¡vel Ã© necessÃ¡rio.';
        guardianSummary.style.display = 'none';
    }

    // Atualiza o texto do resumo conforme os dados do responsÃ¡vel
    updateGuardianSummary();
}

function validatePatientForm() {
    const cpf = document.getElementById('cpf').value.trim();
    const name = document.getElementById('name').value.trim();
    const dataNascimento = document.getElementById('dataNascimento').value;
    const tipoDeficiencia = document.getElementById('tipoDeficiencia').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const age = calculateAge(dataNascimento);
    const isMinor = age !== null && age < 18;

    if (!cpf || !name || !dataNascimento || !tipoDeficiencia || !password || !confirmPassword) {
        showPopup('Preencha todos os campos obrigatÃ³rios.');
        return false;
    }

    if (!validarCPF(cpf)) {
        showPopup('Insira um CPF vÃ¡lido.');
        return false;
    }

    if (!isStrongPassword(password)) {
        showPopup('A senha deve ter 8 caracteres, maiÃºscula, minÃºscula, nÃºmero e caractere especial.');
        return false;
    }

    if (!isStrongPassword(confirmPassword)) {
        showPopup('A senha de confirmaÃ§Ã£o deve obedecer aos mesmos requisitos de seguranÃ§a.');
        return false;
    }

    if (password !== confirmPassword) {
        showPopup('As senhas nÃ£o coincidem.');
        return false;
    }

    if (isMinor && !guardianData) {
        showPopup('Paciente menor de idade deve cadastrar um responsÃ¡vel.');
        return false;
    }

    return true;
}

async function registerPatientAPI(data) {
    try {
        console.debug('Enviando cadastro de paciente:', data);
        const response = await fetch(`${API}/auth/register/patient`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        console.debug('Resposta do cadastro:', response.status, result);
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('Erro na requisiÃ§Ã£o:', error);
        return { ok: false, data: { message: 'Erro de conexÃ£o com o servidor' } };
    }
}

function openGuardianModal() {
    const modal = document.getElementById('guardianModal');
    if (!modal) return;

    const guardianName = document.getElementById('guardianName');
    const guardianRelationship = document.getElementById('guardianRelationship');
    const guardianEmail = document.getElementById('guardianEmail');
    const guardianPassword = document.getElementById('guardianPassword');

    if (guardianData) {
        guardianName.value = guardianData.name;
        guardianRelationship.value = guardianData.parentesco;
        guardianEmail.value = guardianData.email;
        guardianPassword.value = guardianData.password;
    } else {
        guardianName.value = '';
        guardianRelationship.value = '';
        guardianEmail.value = '';
        guardianPassword.value = '';
        guardianData = { permissoes: [] };
    }

    renderGuardianPermissions();
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
}

function closeGuardianModal() {
    const modal = document.getElementById('guardianModal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }
}

function validateGuardianModalForm() {
    const guardianName = document.getElementById('guardianName').value.trim();
    const guardianRelationship = document.getElementById('guardianRelationship').value.trim();
    const guardianEmail = document.getElementById('guardianEmail').value.trim();
    const guardianPassword = document.getElementById('guardianPassword').value;
    const selectedPermissions = getSelectedGuardianPermissions();

    if (!guardianName || !guardianRelationship || !guardianEmail || !guardianPassword) {
        showPopup('Preencha todos os campos do responsÃ¡vel.');
        return false;
    }

    if (!isStrongPassword(guardianPassword)) {
        showPopup('A senha do responsÃ¡vel deve ter 8 caracteres, incluindo maiÃºscula, minÃºscula, nÃºmero e caractere especial.');
        return false;
    }

    if (Array.isArray(availablePermissions) && availablePermissions.length && selectedPermissions.length === 0) {
        showPopup('Selecione pelo menos uma permissÃ£o para o responsÃ¡vel.');
        return false;
    }

    return true;
}

function handleGuardianModalSubmit(event) {
    event.preventDefault();

    if (!validateGuardianModalForm()) {
        return;
    }

    guardianData = {
        name: document.getElementById('guardianName').value.trim(),
        parentesco: document.getElementById('guardianRelationship').value.trim(),
        email: document.getElementById('guardianEmail').value.trim(),
        password: document.getElementById('guardianPassword').value,
        permissoes: getSelectedGuardianPermissions()
    };

    updateGuardianSummary();
    closeGuardianModal();
    showPopup('ResponsÃ¡vel salvo. Continue com o cadastro do paciente.');
}

async function handlePatientRegistration(event) {
    event.preventDefault();
    const submitButton = document.querySelector('#registerPatientForm button[type="submit"]');

    if (!validatePatientForm()) {
        return;
    }

    const cpf = document.getElementById('cpf').value.trim();
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const dataNascimento = document.getElementById('dataNascimento').value;
    const tipoDeficiencia = document.getElementById('tipoDeficiencia').value.trim();
    const age = calculateAge(document.getElementById('dataNascimento').value);
    const isMinor = age !== null && age < 18;
    const password = document.getElementById('password').value;

    showPopup('Deseja confirmar o cadastro?', 'confirm').then(async (confirmed) => {
        if (!confirmed) return;

        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Cadastrando...';

        const cpfDigits = cpf.replace(/\D/g, '');
        const registrationData = {
            cpf: cpfDigits,
            password: password,
            name: name,
            tipoDeficiencia: tipoDeficiencia,
            dataNascimento: dataNascimento
        };

        if (email) {
            registrationData.email = email;
        }

        if (guardianData) {
            registrationData.responsavel = {
                name: guardianData.name,
                parentesco: guardianData.parentesco,
                email: guardianData.email,
                password: guardianData.password,
                permissoes: guardianData.permissoes || []
            };
        }

        const result = await registerPatientAPI(registrationData);

        if (result.ok) {
            showPopup('Cadastro realizado com sucesso! VocÃª pode fazer login agora.');
            document.getElementById('registerPatientForm').reset();
            guardianData = null;
            updateGuardianSummary();
            updateGuardianSection();
            
            localStorage.setItem('lastCPF', cpf);
            localStorage.setItem('lastRegisteredCPF', cpfDigits);
            
            setTimeout(() => {
                window.location.href = 'login-paciente.html';
            }, 1500);
        } else {
            showPopup(result.data.message || 'Erro ao cadastrar. Tente novamente.');
        }

        submitButton.disabled = false;
        submitButton.innerText = 'Criar Conta';
    });
}

document.addEventListener('DOMContentLoaded', function() {
    const cpfInput = document.getElementById('cpf');
    const form = document.getElementById('registerPatientForm');
    const birthInput = document.getElementById('dataNascimento');
    const openModalButton = document.getElementById('openGuardianModalButton');
    const closeModalButton = document.getElementById('closeGuardianModalButton');
    const cancelGuardianButton = document.getElementById('cancelGuardianButton');
    const guardianForm = document.getElementById('guardianModalForm');
    const modal = document.getElementById('guardianModal');

    if (cpfInput) applyMask(cpfInput, cpfMask);
    if (form) form.addEventListener('submit', handlePatientRegistration);
    if (birthInput) birthInput.addEventListener('change', updateGuardianSection);
    if (openModalButton) openModalButton.addEventListener('click', openGuardianModal);
    if (closeModalButton) closeModalButton.addEventListener('click', closeGuardianModal);
    if (cancelGuardianButton) cancelGuardianButton.addEventListener('click', closeGuardianModal);
    if (guardianForm) guardianForm.addEventListener('submit', handleGuardianModalSubmit);

    if (modal) {
        modal.addEventListener('click', event => {
            if (event.target === modal) {
                closeGuardianModal();
            }
        });
    }

    updateGuardianSummary();
    updateGuardianSection();
    fetchAvailablePermissions();

    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});

