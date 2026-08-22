/* ===========================================================================
   dashboard-empresa-unidades.js - filiais da clinica
   ===========================================================================
   Ate aqui "unidade" era um texto escolhido numa lista fixa dentro do HTML
   ("Unidade A", "Unidade B", "Unidade C"), gravado em medicos.unidade. Nao
   existia nenhum endereco por tras - entao nao havia como responder a pergunta
   que a clinica realmente faz ao cadastrar um medico: qual das minhas unidades
   fica mais perto dele?

   Aqui a clinica cadastra as filiais de verdade. Cada uma tem CEP; o servidor
   completa o endereco pelo ViaCEP e converte em latitude/longitude pelo
   Nominatim (OpenStreetMap). Sao essas coordenadas que o cadastro de medico usa
   para ordenar a combobox.
   =========================================================================== */

const UNIDADES_API = `${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/clinic/units`;

let unidadesCadastradas = [];

function escaparHtmlUnidade(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function tokenDaClinica() {
    return window.ConectaSession.getToken();
}

/** Endereco de uma unidade em uma linha, para a tabela. */
function enderecoDaUnidade(unidade) {
    const partes = [unidade.logradouro, unidade.numero, unidade.bairro].filter(Boolean);
    return partes.length ? partes.join(', ') : '--';
}

function renderizarUnidades() {
    const corpo = document.getElementById('unitsTableBody');
    const contador = document.getElementById('unitsCount');
    if (!corpo) return;

    if (contador) {
        contador.textContent = unidadesCadastradas.length === 1
            ? '1 unidade'
            : `${unidadesCadastradas.length} unidades`;
    }

    if (!unidadesCadastradas.length) {
        corpo.innerHTML = '<tr><td colspan="5" class="table-empty">Nenhuma unidade cadastrada ainda. Cadastre a primeira acima.</td></tr>';
        return;
    }

    corpo.innerHTML = unidadesCadastradas.map((unidade) => {
        const temCoordenada = unidade.latitude !== null && unidade.longitude !== null;

        // A coluna de coordenadas nao e enfeite: unidade sem coordenada nao
        // entra na ordenacao por distancia, e a clinica precisa enxergar isso
        // para corrigir o endereco.
        const coordenada = temCoordenada
            ? `${Number(unidade.latitude).toFixed(4)}, ${Number(unidade.longitude).toFixed(4)}`
            : '<span class="status-dot break">Sem coordenada</span>';

        return `
            <tr>
                <td><strong>${escaparHtmlUnidade(unidade.nome)}</strong></td>
                <td>${escaparHtmlUnidade(enderecoDaUnidade(unidade))}</td>
                <td>${escaparHtmlUnidade([unidade.cidade, unidade.estado].filter(Boolean).join(' / ') || '--')}</td>
                <td>${coordenada}</td>
                <td>
                    <button type="button" class="btn-table-action btn-table-action--danger" data-remover-unidade="${unidade.id}">
                        <i class="ph ph-trash" aria-hidden="true"></i> Desativar
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    corpo.querySelectorAll('[data-remover-unidade]').forEach((botao) => {
        botao.addEventListener('click', () => desativarUnidade(Number(botao.dataset.removerUnidade)));
    });
}

async function carregarUnidades() {
    const token = tokenDaClinica();
    if (!token) return [];

    try {
        const resposta = await fetch(UNIDADES_API, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!resposta.ok) {
            unidadesCadastradas = [];
            renderizarUnidades();
            return [];
        }

        const corpo = await resposta.json();
        unidadesCadastradas = Array.isArray(corpo) ? corpo : [];
        renderizarUnidades();
        return unidadesCadastradas;
    } catch (erro) {
        console.error('Erro ao carregar unidades:', erro);
        unidadesCadastradas = [];
        renderizarUnidades();
        return [];
    }
}

async function cadastrarUnidade(evento) {
    evento.preventDefault();

    const formulario = evento.target;
    const botao = formulario.querySelector('button[type="submit"]');
    const textoOriginal = botao.innerHTML;

    const dados = {
        nome: document.getElementById('unitName').value.trim(),
        cep: document.getElementById('unitCep').value.trim(),
        logradouro: document.getElementById('unitStreet').value.trim(),
        numero: document.getElementById('unitNumber').value.trim(),
        cidade: document.getElementById('unitCity').value.trim(),
        estado: document.getElementById('unitState').value.trim().toUpperCase()
    };

    if (!dados.nome) {
        showPopup('Informe o nome da unidade.');
        return;
    }

    if (window.ConectaEndereco.apenasDigitos(dados.cep).length !== 8) {
        showPopup('Informe um CEP válido para a unidade.');
        return;
    }

    // Campos vazios sao omitidos: o servidor completa pelo CEP, e mandar string
    // vazia sobrescreveria o que o ViaCEP devolveu.
    const corpo = Object.fromEntries(
        Object.entries(dados).filter(([, valor]) => valor !== '')
    );

    botao.disabled = true;
    botao.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Cadastrando...';

    try {
        const resposta = await fetch(UNIDADES_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tokenDaClinica()}`
            },
            body: JSON.stringify(corpo)
        });

        const resultado = await resposta.json().catch(() => ({}));

        if (!resposta.ok) {
            const detalhe = Array.isArray(resultado.errors) && resultado.errors.length
                ? resultado.errors.map((problema) => problema.message).join(' ')
                : '';
            showPopup(detalhe || resultado.message || 'Erro ao cadastrar a unidade.');
            return;
        }

        formulario.reset();
        await carregarUnidades();

        // Sem coordenada a unidade existe, mas fica fora da ordenacao por
        // distancia - vale avisar em vez de deixar a clinica descobrir depois.
        showPopup(resultado.geocodificado === false
            ? `Unidade ${resultado.nome} cadastrada, mas não foi possível localizar as coordenadas do endereço. Ela não entrará na ordenação por distância.`
            : `Unidade ${resultado.nome} cadastrada com sucesso.`);

        // A combobox do cadastro de medico precisa refletir a nova unidade.
        if (typeof window.recarregarUnidadesDoCadastro === 'function') {
            window.recarregarUnidadesDoCadastro();
        }
    } catch (erro) {
        console.error('Erro ao cadastrar unidade:', erro);
        showPopup('Erro de conexão ao cadastrar a unidade.');
    } finally {
        botao.disabled = false;
        botao.innerHTML = textoOriginal;
    }
}

/**
 * Desativa em vez de apagar: medicos ja vinculados continuam apontando para a
 * unidade, e apagar deixaria o cadastro deles sem referencia nenhuma.
 */
async function desativarUnidade(id) {
    const unidade = unidadesCadastradas.find((item) => Number(item.id) === Number(id));
    const confirmado = await showPopup(
        `Desativar a unidade ${unidade?.nome || id}? Ela deixa de aparecer no cadastro de novos médicos.`,
        'confirm'
    );

    if (!confirmado) return;

    try {
        const resposta = await fetch(`${UNIDADES_API}/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${tokenDaClinica()}` }
        });

        const corpo = await resposta.json().catch(() => ({}));

        if (!resposta.ok) {
            showPopup(corpo.message || 'Erro ao desativar a unidade.');
            return;
        }

        await carregarUnidades();

        if (typeof window.recarregarUnidadesDoCadastro === 'function') {
            window.recarregarUnidadesDoCadastro();
        }

        showPopup('Unidade desativada.');
    } catch (erro) {
        console.error('Erro ao desativar unidade:', erro);
        showPopup('Erro de conexão ao desativar a unidade.');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const formulario = document.getElementById('unitForm');
    if (!formulario) return;

    const campoCep = document.getElementById('unitCep');
    const campoUf = document.getElementById('unitState');

    window.ConectaEndereco.ligarMascaraDeCep(campoCep);
    window.ConectaEndereco.ligarMascaraDeUf(campoUf);

    window.ConectaEndereco.ligarBuscaDeCep(campoCep, {
        idDaDica: 'unitCepHint',
        textoInicial: 'O endereço é completado pelo CEP e convertido em coordenadas.',
        aoEncontrar(endereco) {
            const rua = document.getElementById('unitStreet');
            const cidade = document.getElementById('unitCity');

            if (rua && endereco.logradouro) rua.value = endereco.logradouro;
            if (cidade && endereco.cidade) cidade.value = endereco.cidade;
            if (campoUf && endereco.estado) campoUf.value = endereco.estado;

            window.ConectaEndereco.definirDica(
                'unitCepHint',
                'Endereço encontrado. Confirme o número antes de salvar.',
                'ok'
            );
        }
    });

    formulario.addEventListener('submit', cadastrarUnidade);

    carregarUnidades();
});

// Consumido pelo cadastro de medico, que precisa da lista para montar a
// combobox antes mesmo de o endereco ser informado.
window.obterUnidadesDaClinica = () => unidadesCadastradas.slice();
window.carregarUnidadesDaClinica = carregarUnidades;
