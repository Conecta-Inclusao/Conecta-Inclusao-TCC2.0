function crmMask(value) {
    let v = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.length > 7) v = v.slice(0, 7);
    return v;
}

function applyMask(input, maskFn) {
    input.addEventListener('input', function(event) {
        event.target.value = maskFn(event.target.value);
    });
}

function validateDoctorForm() {
    const crm = document.getElementById('crm').value.trim();
    const name = document.getElementById('name').value.trim();
    const unidade = document.getElementById('unidade').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!crm || !name || !unidade || !password || !confirmPassword) {
        showPopup('Preencha todos os campos obrigatórios.');
        return false;
    }

    if (crm.length < 4 || crm.length > 7) {
        showPopup('CRM deve ter entre 4 e 7 caracteres.');
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

    return true;
}

async function registerDoctorAPI(data) {
    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/register/doctor`, {
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

function handleDoctorRegistration(event) {
    event.preventDefault();
    const submitButton = document.querySelector('.btn-submit');

    if (!validateDoctorForm()) {
        return;
    }

    const crm = document.getElementById('crm').value.trim();
    const name = document.getElementById('name').value.trim();
    const especialidade = document.getElementById('especialidade').value.trim();
    const unidade = document.getElementById('unidade').value.trim();
    const bio = document.getElementById('bio').value.trim();
    const password = document.getElementById('password').value;

    showPopup('Deseja confirmar o cadastro deste médico?', 'confirm').then(async (confirmed) => {
        if (!confirmed) return;

        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Cadastrando...';

        const registrationData = {
            crm: crm,
            password: password,
            name: name,
            especialidade: especialidade,
            unidade: unidade,
            bio: bio || null
        };

        const result = await registerDoctorAPI(registrationData);

        if (result.ok) {
            showPopup('Médico cadastrado com sucesso!');
            document.getElementById('registerDoctorForm').reset();
            
            // Armazenar dados em localStorage para pré-preenchimento no login
            localStorage.setItem('lastCRM', crm);
            localStorage.setItem('lastUnidade', unidade);
            localStorage.setItem('lastRegisteredCRM', crm);
            
            // Armazenar na sessionStorage para o dashboard
            sessionStorage.setItem('professionalUnit', unidade);
            
            setTimeout(() => {
                window.history.back();
            }, 1500);
        } else {
            showPopup(result.data.message || 'Erro ao cadastrar. Tente novamente.');
        }

        submitButton.disabled = false;
        submitButton.innerText = 'Cadastrar Médico';
    });
}

async function loadClinics() {
    // Esta função buscaria as clínicas do backend
    // Por enquanto, será uma lista estática/mock
    // No futuro, implementar: GET /auth/clinicas (com autenticação)
    const clinicaSelect = document.getElementById('clinicaId');
    if (!clinicaSelect) return;
    
    // Mock de dados - substitua por chamada real quando endpoint disponível
    const clinicas = [
        { id: 1, name: 'Clínica Saúde Total' },
        { id: 2, name: 'Centro Médico Inclusivo' },
        { id: 3, name: 'Clínica de Reabilitação São Paulo' }
    ];

    clinicas.forEach(clinica => {
        const option = document.createElement('option');
        option.value = clinica.id;
        option.textContent = clinica.name;
        clinicaSelect.appendChild(option);
    });
}

document.addEventListener('DOMContentLoaded', function() {
    const crmInput = document.getElementById('crm');
    const form = document.getElementById('registerDoctorForm');

    if (crmInput) applyMask(crmInput, crmMask);
    if (form) form.addEventListener('submit', handleDoctorRegistration);

    loadClinics();

    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});
