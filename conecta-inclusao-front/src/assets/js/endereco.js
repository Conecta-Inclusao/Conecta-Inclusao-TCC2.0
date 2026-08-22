/* ===========================================================================
   endereco.js - CEP, UF e geocodificacao (lado do navegador)
   ===========================================================================
   Compartilhado pelo cadastro de unidades e pelo cadastro de medico, que vivem
   na mesma pagina mas em scripts diferentes.

   A consulta de CEP vai para a NOSSA API (/auth/cep/:cep), nunca direto para o
   ViaCEP. Dois motivos:

     1. A CSP definida em app.js libera apenas `connect-src 'self'`. Um fetch do
        navegador para viacep.com.br e bloqueado antes de sair quando o front e
        servido pela propria API.
     2. O servidor guarda em cache e respeita o limite de uso do Nominatim, que
        e quem transforma o endereco em latitude/longitude. O navegador nem
        consegue mandar o User-Agent que o Nominatim exige.

   E um script classico (nao modulo) de proposito: as telas do dashboard da
   clinica sao carregadas com <script src> comum.
   =========================================================================== */
(function () {
    'use strict';

    var AUTH_API = (window.APP_CONFIG && window.APP_CONFIG.AUTH_API_URL) || '/auth';

    var UFS = [
        'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS',
        'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC',
        'SE', 'SP', 'TO'
    ];

    function apenasDigitos(valor) {
        return String(valor || '').replace(/\D/g, '');
    }

    function mascaraCep(valor) {
        var v = apenasDigitos(valor).slice(0, 8);
        return v.replace(/(\d{5})(\d)/, '$1-$2');
    }

    /** Aplica a mascara de CEP a um campo enquanto o usuario digita. */
    function ligarMascaraDeCep(campo) {
        if (!campo) return;
        campo.addEventListener('input', function (evento) {
            evento.target.value = mascaraCep(evento.target.value);
        });
    }

    /** Restringe um campo a duas letras maiusculas (UF). */
    function ligarMascaraDeUf(campo) {
        if (!campo) return;
        campo.addEventListener('input', function (evento) {
            evento.target.value = evento.target.value
                .replace(/[^a-zA-Z]/g, '')
                .toUpperCase()
                .slice(0, 2);
        });
    }

    /** Preenche um <select> com as 27 UFs. */
    function preencherSelectDeUf(select, rotuloVazio) {
        if (!select) return;

        select.innerHTML = '<option value="">' + (rotuloVazio || 'Selecione...') + '</option>';

        UFS.forEach(function (uf) {
            var opcao = document.createElement('option');
            opcao.value = uf;
            opcao.textContent = uf;
            select.appendChild(opcao);
        });
    }

    /**
     * Escreve uma mensagem de apoio abaixo de um campo, com estado visual.
     * @param {string} id id do <small class="field-hint">
     * @param {string} texto
     * @param {'ok'|'erro'|''} estado
     */
    function definirDica(id, texto, estado) {
        var dica = document.getElementById(id);
        if (!dica) return;

        dica.textContent = texto;
        dica.className = estado ? 'field-hint field-hint--' + estado : 'field-hint';
    }

    /**
     * Consulta o CEP na API.
     * @returns {Promise<{ok: boolean, data?: object, message?: string}>}
     */
    function consultarCep(cep) {
        var digitos = apenasDigitos(cep);

        if (digitos.length !== 8) {
            return Promise.resolve({ ok: false, message: 'CEP deve ter 8 dígitos.' });
        }

        return fetch(AUTH_API + '/cep/' + digitos)
            .then(function (resposta) {
                return resposta.json().then(function (corpo) {
                    return resposta.ok
                        ? { ok: true, data: corpo }
                        : { ok: false, message: corpo.message || 'Não foi possível buscar o CEP.' };
                });
            })
            .catch(function (erro) {
                console.error('Erro ao consultar CEP:', erro);
                return { ok: false, message: 'Erro de conexão ao consultar o CEP.' };
            });
    }

    /**
     * Liga a busca automatica de CEP a um campo.
     *
     * `aoEncontrar` recebe o endereco resolvido; `aoLimpar` e chamado quando o
     * campo volta a ter menos de 8 digitos. O ultimo CEP consultado e guardado
     * para nao repetir a chamada a cada tecla - mas e zerado em caso de erro,
     * senao uma falha de rede impediria nova tentativa com o mesmo CEP.
     */
    function ligarBuscaDeCep(campo, opcoes) {
        if (!campo) return;

        var config = opcoes || {};
        var ultimoConsultado = '';

        function executar() {
            var digitos = apenasDigitos(campo.value);

            if (digitos.length < 8) {
                ultimoConsultado = '';
                if (config.idDaDica) definirDica(config.idDaDica, config.textoInicial || 'Digite o CEP completo.', '');
                if (config.aoLimpar) config.aoLimpar();
                return;
            }

            if (digitos === ultimoConsultado) return;
            ultimoConsultado = digitos;

            if (config.idDaDica) definirDica(config.idDaDica, 'Buscando endereço...', '');

            consultarCep(digitos).then(function (resultado) {
                if (!resultado.ok) {
                    ultimoConsultado = '';
                    if (config.idDaDica) definirDica(config.idDaDica, resultado.message, 'erro');
                    if (config.aoFalhar) config.aoFalhar(resultado.message);
                    return;
                }

                if (config.aoEncontrar) config.aoEncontrar(resultado.data);
            });
        }

        campo.addEventListener('input', executar);
        campo.addEventListener('blur', executar);
    }

    /** Formata a distancia para exibicao ("850 m", "3,2 km"). */
    function formatarDistancia(km) {
        if (km === null || km === undefined || Number.isNaN(Number(km))) return '';

        var valor = Number(km);
        if (valor < 1) return Math.round(valor * 1000) + ' m';

        return valor.toFixed(1).replace('.', ',') + ' km';
    }

    window.ConectaEndereco = {
        UFS: UFS,
        apenasDigitos: apenasDigitos,
        mascaraCep: mascaraCep,
        ligarMascaraDeCep: ligarMascaraDeCep,
        ligarMascaraDeUf: ligarMascaraDeUf,
        preencherSelectDeUf: preencherSelectDeUf,
        definirDica: definirDica,
        consultarCep: consultarCep,
        ligarBuscaDeCep: ligarBuscaDeCep,
        formatarDistancia: formatarDistancia
    };
})();
