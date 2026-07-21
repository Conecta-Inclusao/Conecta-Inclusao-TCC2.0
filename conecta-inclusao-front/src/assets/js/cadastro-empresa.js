function applyMask(input, maskFn) {
    input.addEventListener('input', function(event) {
        event.target.value = maskFn(event.target.value);
    });
}

function cnpjMask(value) {
    let v = value.replace(/\D/g, '');
    if (v.length > 14) v = v.slice(0, 14);
    v = v.replace(/(\d{2})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1/$2');
    v = v.replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    return v;
}

function cepMask(value) {
    let v = value.replace(/\D/g, '');
    if (v.length > 8) v = v.slice(0, 8);
    v = v.replace(/(\d{5})(\d)/, '$1-$2');
    return v;
}

let lastSearchedZip = '';
let zipLookupController = null;

async function fetchAddressByZip(zip) {
    const response = await fetch(`https://viacep.com.br/ws/${zip}/json/`, {
        signal: zipLookupController?.signal
    });

    if (!response.ok) {
        throw new Error('Nao foi possivel consultar o CEP.');
    }

    return response.json();
}

function fillAddressFields(addressData) {
    const addressInput = document.getElementById('address');
    const cityInput = document.getElementById('city');
    const stateInput = document.getElementById('state');

    if (addressInput && addressData.logradouro) {
        addressInput.value = addressData.logradouro;
    }

    if (cityInput && addressData.localidade) {
        cityInput.value = addressData.localidade;
    }

    if (stateInput && addressData.uf) {
        stateInput.value = addressData.uf.toUpperCase();
    }
}

async function handleZipLookup(event) {
    const zipInput = event.target;
    const zipDigits = zipInput.value.replace(/\D/g, '');

    if (zipDigits.length < 8) {
        lastSearchedZip = '';
        return;
    }

    if (zipDigits === lastSearchedZip) return;

    lastSearchedZip = zipDigits;

    if (zipLookupController) {
        zipLookupController.abort();
    }

    zipLookupController = new AbortController();
    zipInput.dataset.loadingZip = 'true';

    try {
        const addressData = await fetchAddressByZip(zipDigits);

        if (addressData.erro) {
            showPopup('CEP nao encontrado.');
            return;
        }

        fillAddressFields(addressData);
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Erro ao consultar CEP:', error);
        showPopup('Nao foi possivel buscar o endereco pelo CEP.');
    } finally {
        zipInput.dataset.loadingZip = 'false';
    }
}

function phoneMask(value) {
    let v = value.replace(/\D/g, '');
    if (v.length > 11) v = v.slice(0, 11);
    v = v.replace(/(\d{2})(\d)/, '($1) $2');
    v = v.replace(/(\d{5})(\d)/, '$1-$2');
    return v;
}

function validateCompanyForm() {
    const companyName = document.getElementById('companyName').value.trim();
    const companyLegalName = document.getElementById('companyLegalName').value.trim();
    const cnpj = document.getElementById('cnpj').value.trim();
    const email = document.getElementById('companyEmail').value.trim();
    const phone = document.getElementById('companyPhone').value.trim();
    const contact = document.getElementById('companyContact').value.trim();
    const role = document.getElementById('contactRole').value.trim();
    const branch = document.getElementById('companyBranch').value.trim();
    const address = document.getElementById('address').value.trim();
    const streetNumber = document.getElementById('streetNumber').value.trim();
    const city = document.getElementById('city').value.trim();
    const state = document.getElementById('state').value.trim();
    const zip = document.getElementById('zip').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!companyName || !companyLegalName || !cnpj || !email || !phone || !contact || !role || !branch || !address || !streetNumber || !city || !state || !zip || !password || !confirmPassword) {
        showPopup('Preencha todos os campos obrigatÃ³rios antes de continuar.');
        return false;
    }

    if (cnpj.length < 18) {
        showPopup('Insira um CNPJ vÃ¡lido.');
        return false;
    }

    if (zip.length < 9) {
        showPopup('Insira um CEP vÃ¡lido.');
        return false;
    }

    if (state.length !== 2) {
        showPopup('Informe o estado em formato UF.');
        return false;
    }

    if (!isStrongPassword(password)) {
        showPopup('A senha deve ter 8 caracteres, maiÃºscula, minÃºscula, nÃºmero e caractere especial.');
        return false;
    }

    if (password !== confirmPassword) {
        showPopup('As senhas nÃ£o coincidem.');
        return false;
    }

    return true;
}

async function registerClinicAPI(data) {
    try {
        const response = await fetch('https://conecta-inclusao-tcc2-0.onrender.com/auth/register/clinic', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('Erro na requisiÃ§Ã£o:', error);
        return { ok: false, data: { message: 'Erro de conexÃ£o' } };
    }
}

function handleCompanyRegistration(event) {
    event.preventDefault();
    const submitButton = document.querySelector('.btn-register');

    const companyName = document.getElementById('companyName').value.trim();
    const companyLegalName = document.getElementById('companyLegalName').value.trim();
    const cnpj = document.getElementById('cnpj').value.trim();
    const email = document.getElementById('companyEmail').value.trim();
    const phone = document.getElementById('companyPhone').value.trim();
    const contact = document.getElementById('companyContact').value.trim();
    const role = document.getElementById('contactRole').value.trim();
    const branch = document.getElementById('companyBranch').value.trim();
    const address = document.getElementById('address').value.trim();
    const streetNumber = document.getElementById('streetNumber').value.trim();
    const city = document.getElementById('city').value.trim();
    const state = document.getElementById('state').value.trim();
    const zip = document.getElementById('zip').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!companyName || !companyLegalName || !cnpj || !email || !phone || !contact || !role || !branch || !address || !streetNumber || !city || !state || !zip || !password || !confirmPassword) {
        showPopup('Preencha todos os campos obrigatÃ³rios antes de continuar.');
        return;
    }

    if (cnpj.length < 18) {
        showPopup('Insira um CNPJ vÃ¡lido.');
        return;
    }

    if (zip.length < 9) {
        showPopup('Insira um CEP vÃ¡lido.');
        return;
    }

    if (state.length !== 2) {
        showPopup('Informe o estado em formato UF.');
        return;
    }

    if (!isStrongPassword(password)) {
        showPopup('A senha deve ter 8 caracteres, maiÃºscula, minÃºscula, nÃºmero e caractere especial.');
        return;
    }

    if (password !== confirmPassword) {
        showPopup('As senhas nÃ£o coincidem.');
        return;
    }

    showPopup('Deseja confirmar o cadastro da empresa?', 'confirm').then(async (confirmed) => {
        if (!confirmed) return;

        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Cadastrando...';

        const cnpjDigits = cnpj.replace(/\D/g, '');
        const fullAddress = `${address}, ${streetNumber}`;
        const registrationData = {
            cnpj: cnpjDigits,
            password: password,
            name: companyName,
            email: email,
            razaoSocial: companyLegalName,
            endereco: fullAddress,
            numero: streetNumber,
            cidade: city,
            estado: state,
            cep: zip.replace('-', ''),
            telefone: phone.replace(/\D/g, ''),
            responsavel: contact
        };

        const result = await registerClinicAPI(registrationData);

        if (result.ok) {
            showPopup('Cadastro realizado com sucesso! VocÃª pode fazer login agora.');
            document.getElementById('registerCompanyForm').reset();
            
            // Armazenar CNPJ formatado em localStorage para prÃ©-preencher o login
            const registeredCnpj = result.data?.identifier || result.data?.cnpj || cnpjDigits;
            localStorage.setItem('lastCNPJ', cnpjMask(registeredCnpj));
            localStorage.setItem('lastRegisteredCNPJ', registeredCnpj);
            
            window.location.href = 'login-empresa.html';
        } else {
            showPopup(result.data.message || 'Erro ao cadastrar. Tente novamente.');
        }

        submitButton.disabled = false;
        submitButton.innerText = 'Criar Conta';
    });
}

document.addEventListener('DOMContentLoaded', function() {
    const cnpjInput = document.getElementById('cnpj');
    const zipInput = document.getElementById('zip');
    const phoneInput = document.getElementById('companyPhone');
    const form = document.getElementById('registerCompanyForm');

    if (cnpjInput) applyMask(cnpjInput, cnpjMask);
    if (zipInput) {
        applyMask(zipInput, cepMask);
        zipInput.addEventListener('input', handleZipLookup);
        zipInput.addEventListener('blur', handleZipLookup);
    }
    if (phoneInput) applyMask(phoneInput, phoneMask);
    if (form) form.addEventListener('submit', handleCompanyRegistration);

    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});

