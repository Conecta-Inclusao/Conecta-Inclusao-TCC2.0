let guardianData = null;

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
        summaryText.textContent = 'Nenhum responsável adicionado.';
        hiddenName.value = '';
        return;
    }

    const parts = [guardianData.name];
    if (guardianData.relationship) parts.push(`(${guardianData.relationship})`);
    if (guardianData.email) parts.push(guardianData.email);
    summaryText.textContent = parts.join(' ');
    hiddenName.value = guardianData.name;
}

function updateGuardianSection() {
    const birthDate = document.getElementById('dataNascimento').value;
    const age = calculateAge(birthDate);
    const guardianAdvice = document.getElementById('guardianAdvice');
    const guardianSummary = document.getElementById('guardianSummary');

    const openModalBtn = document.getElementById('openGuardianModalButton');

    if (age !== null && age < 18) {
        guardianAdvice.textContent = 'Paciente menor de idade exige responsável. Preencha os dados do responsável.';
        guardianSummary.style.display = 'block';
        if (openModalBtn) openModalBtn.innerText = 'Adicionar responsável';
    } else if (age !== null && age >= 18) {
        guardianAdvice.textContent = 'Paciente maior de idade. Adicionar responsável é opcional.';
        guardianSummary.style.display = 'block';
        if (openModalBtn) openModalBtn.innerText = 'Adicionar responsável (opcional)';
    } else {
        guardianAdvice.textContent = 'Preencha a data de nascimento para verificar se responsável é necessário.';
        guardianSummary.style.display = 'none';
    }

    // Atualiza o texto do resumo conforme os dados do responsável
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
        showPopup('Preencha todos os campos obrigatórios.');
        return false;
    }

    if (cpf.length < 14) {
        showPopup('Insira um CPF válido.');
        return false;
    }

    if (!isStrongPassword(password)) {
        showPopup('A senha deve ter 8 caracteres, maiúscula, minúscula, número e caractere especial.');
        return false;
    }

    if (password !== confirmPassword) {
        showPopup('As senhas não coincidem.');
        return false;
    }

    if (isMinor && !guardianData) {
        showPopup('Paciente menor de idade deve cadastrar um responsável.');
        return false;
    }

    return true;
}

async function registerPatientAPI(data) {
    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/register/patient`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('Erro na requisição:', error);
        return { ok: false, data: { message: 'Erro de conexão com o servidor' } };
    }
}

/**
 * Carrega o catalogo de permissoes (rota publica) e monta os checkboxes. Os
 * values sao os ids da tabela `permissoes` - sao eles que o backend grava em
 * responsavel_permissoes.
 */
async function loadGuardianPermissions() {
    const grid = document.getElementById('guardianPermissionsGrid');
    if (!grid || grid.dataset.loaded === 'true') return;

    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/permissoes`);
        // A rota responde { permissions: [{ id, key, label }] }.
        const body = await response.json();
        const permissions = Array.isArray(body?.permissions) ? body.permissions : [];

        if (!response.ok || !permissions.length) {
            grid.innerHTML = '<span class="loading-inline">Não foi possível carregar as permissões.</span>';
            return;
        }

        grid.innerHTML = '';
        permissions.forEach(permission => {
            const option = document.createElement('label');
            option.className = 'checkbox-item';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.name = 'guardianPermission';
            input.value = permission.id;

            const text = document.createElement('span');
            // textContent em vez de template string: o rotulo vem do banco e nao
            // deve ser interpretado como HTML.
            text.textContent = permission.label;

            option.appendChild(input);
            option.appendChild(text);
            grid.appendChild(option);
        });
        grid.dataset.loaded = 'true';
    } catch (error) {
        console.error('Erro ao carregar permissões:', error);
        grid.innerHTML = '<span class="loading-inline">Não foi possível carregar as permissões.</span>';
    }
}

function getSelectedGuardianPermissions() {
    return Array.from(document.querySelectorAll('input[name="guardianPermission"]:checked'))
        .map(input => Number(input.value))
        .filter(id => Number.isInteger(id) && id > 0);
}

function openGuardianModal() {
    const modal = document.getElementById('guardianModal');
    if (!modal) return;

    const guardianName = document.getElementById('guardianName');
    const guardianCPF = document.getElementById('guardianCPF');
    const guardianRelationship = document.getElementById('guardianRelationship');
    const guardianEmail = document.getElementById('guardianEmail');
    const guardianPassword = document.getElementById('guardianPassword');

    loadGuardianPermissions();

    if (guardianData) {
        guardianName.value = guardianData.name;
        guardianCPF.value = guardianData.cpf;
        guardianRelationship.value = guardianData.relationship;
        guardianEmail.value = guardianData.email;
        guardianPassword.value = guardianData.password;
    } else {
        guardianName.value = '';
        guardianCPF.value = '';
        guardianRelationship.value = '';
        guardianEmail.value = '';
        guardianPassword.value = '';
    }

    document.querySelectorAll('input[name="guardianPermission"]').forEach(input => {
        input.checked = Boolean(guardianData?.permissions?.includes(Number(input.value)));
    });

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
    const guardianCPF = document.getElementById('guardianCPF').value.trim();
    const guardianRelationship = document.getElementById('guardianRelationship').value.trim();
    const guardianEmail = document.getElementById('guardianEmail').value.trim();
    const guardianPassword = document.getElementById('guardianPassword').value;

    if (!guardianName || !guardianCPF || !guardianRelationship || !guardianEmail || !guardianPassword) {
        showPopup('Preencha todos os campos do responsável.');
        return false;
    }

    if (!validarCPF(guardianCPF)) {
        showPopup('CPF do responsável inválido.');
        return false;
    }

    // O responsavel tem login proprio, entao a senha segue a mesma regra de
    // forca do paciente - o backend recusa qualquer coisa mais fraca.
    if (!isStrongPassword(guardianPassword)) {
        showPopup('A senha do responsável deve ter 8+ caracteres, com maiúscula, minúscula, número e caractere especial.');
        return false;
    }

    const patientCPF = document.getElementById('cpf').value.replace(/\D/g, '');
    if (patientCPF && patientCPF === guardianCPF.replace(/\D/g, '')) {
        showPopup('O CPF do responsável deve ser diferente do CPF do paciente.');
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
        cpf: document.getElementById('guardianCPF').value.trim(),
        relationship: document.getElementById('guardianRelationship').value.trim(),
        email: document.getElementById('guardianEmail').value.trim(),
        password: document.getElementById('guardianPassword').value,
        permissions: getSelectedGuardianPermissions()
    };

    updateGuardianSummary();
    closeGuardianModal();
    showPopup('Responsável salvo. Continue com o cadastro do paciente.');
}

async function handlePatientRegistration(event) {
    event.preventDefault();
    const submitButton = document.querySelector('.btn-submit');

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
            email: email || null,
            nomeResponsavel: guardianData?.name || null,
            tipoDeficiencia: tipoDeficiencia,
            dataNascimento: dataNascimento
        };

        if (guardianData) {
            // As chaves seguem o schema do backend (name/relationship/...), nao a
            // traducao para portugues que era enviada antes e chegava vazia do
            // outro lado.
            registrationData.responsavel = {
                name: guardianData.name,
                cpf: guardianData.cpf.replace(/\D/g, ''),
                relationship: guardianData.relationship,
                email: guardianData.email,
                password: guardianData.password,
                permissions: guardianData.permissions || []
            };
        }

        const result = await registerPatientAPI(registrationData);

        if (result.ok) {
            showPopup('Cadastro realizado com sucesso! Você pode fazer login agora.');
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

    const guardianCpfInput = document.getElementById('guardianCPF');

    if (cpfInput) applyMask(cpfInput, cpfMask);
    if (guardianCpfInput) applyMask(guardianCpfInput, cpfMask);
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

    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});
