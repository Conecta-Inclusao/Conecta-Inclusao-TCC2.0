/* ===========================================================================
   session.js - sessao do usuario, isolada por aba
   ===========================================================================
   PROBLEMA QUE ESTE ARQUIVO RESOLVE

   A sessao ficava em localStorage, que e compartilhado por TODAS as abas da
   mesma origem. Com o dashboard do medico aberto numa aba e o do paciente em
   outra, o segundo login sobrescrevia o `token` do primeiro. Bastava atualizar
   a aba antiga para ela passar a rodar com a identidade da outra - foi
   exatamente isso que aconteceu: a aba do paciente virou o medico.

   sessionStorage tem escopo de aba: sobrevive ao F5, mas nao vaza para a aba
   ao lado. E o comportamento correto aqui.

   Alem do isolamento, este modulo centraliza o que antes nao existia em lugar
   nenhum: deteccao de token expirado. Sem isso o token vencia em silencio, as
   requisicoes voltavam 401, e a tela simplesmente renderizava vazia - o
   usuario logado parecia um visitante sem permissao.

   E um script classico (nao modulo) de proposito: precisa rodar antes de
   tudo e ser visivel tanto para os scripts classicos quanto para os modulos.
   =========================================================================== */
(function () {
    'use strict';

    var CHAVE_TOKEN = 'token';
    var CHAVE_USER = 'user';

    // Para onde mandar quem nao tem sessao valida, por perfil.
    var LOGIN_POR_PERFIL = {
        paciente: 'login-paciente.html',
        medico: 'login-medico.html',
        clinica: 'login-empresa.html',
        responsavel: 'login-responsavel.html'
    };

    var LOGIN_PADRAO = 'lndex.html';

    // -----------------------------------------------------------------------
    // Migracao da sessao antiga (localStorage -> sessionStorage)
    // -----------------------------------------------------------------------
    // Quem ja estava logado quando esta versao subiu tem o token no
    // localStorage. A primeira aba a carregar adota esse token; em seguida ele
    // e apagado do localStorage. Esse "apagar sempre" e o ponto importante: e o
    // que impede uma segunda aba de herdar a mesma identidade depois.
    (function migrarSessaoAntiga() {
        try {
            var tokenAntigo = localStorage.getItem(CHAVE_TOKEN);
            if (!tokenAntigo) return;

            if (!sessionStorage.getItem(CHAVE_TOKEN)) {
                sessionStorage.setItem(CHAVE_TOKEN, tokenAntigo);
                var userAntigo = localStorage.getItem(CHAVE_USER);
                if (userAntigo) sessionStorage.setItem(CHAVE_USER, userAntigo);
            }

            localStorage.removeItem(CHAVE_TOKEN);
            localStorage.removeItem(CHAVE_USER);
        } catch (erro) {
            // Navegador com storage bloqueado: segue sem sessao.
        }
    })();

    // -----------------------------------------------------------------------
    // Leitura e escrita
    // -----------------------------------------------------------------------
    function getToken() {
        try {
            return sessionStorage.getItem(CHAVE_TOKEN);
        } catch (erro) {
            return null;
        }
    }

    function getUser() {
        try {
            return JSON.parse(sessionStorage.getItem(CHAVE_USER) || '{}');
        } catch (erro) {
            return {};
        }
    }

    function setUser(user) {
        try {
            sessionStorage.setItem(CHAVE_USER, JSON.stringify(user || {}));
        } catch (erro) { /* storage indisponivel */ }
    }

    function saveSession(token, user) {
        // Limpa o que sobrou de qualquer sessao anterior nesta aba antes de
        // gravar a nova. Entrar com outra conta sem passar pelo botao "Sair"
        // (login direto pela URL, ou depois de uma sessao expirada) deixava as
        // chaves auxiliares do usuario antigo no lugar.
        clearSession();

        try {
            sessionStorage.setItem(CHAVE_TOKEN, token);
            if (user) sessionStorage.setItem(CHAVE_USER, JSON.stringify(user));
            // Garantia extra: nada de sessao volta a morar no localStorage.
            localStorage.removeItem(CHAVE_TOKEN);
            localStorage.removeItem(CHAVE_USER);
        } catch (erro) { /* storage indisponivel */ }
        agendarExpiracao();
    }

    // Chaves auxiliares que as telas gravam para exibicao (nome no cabecalho,
    // registro, unidade, historico do assistente, cache de responsaveis).
    // Todas pertencem ao usuario logado e precisam ir embora junto com ele.
    var PREFIXOS_DA_SESSAO = [
        'patient',              // patientName, patientId
        'patientProfessionalMessages',  // historico do chatbot, por paciente
        'patientGuardians',     // cache dos responsaveis, por paciente
        'professional',         // professionalName, professionalRegistry, professionalUnit
        'empresa'               // empresaNomeFantasia, empresaCnpj, empresaRazaoSocial
    ];

    /**
     * Encerra a sessao e apaga TUDO que pertencia ao usuario nesta aba.
     *
     * Antes so o token e o objeto `user` eram removidos. As chaves auxiliares
     * ficavam para tras, e o proximo login na mesma aba herdava o que sobrou:
     * o painel do medico mostrava o nome e o CRM do medico anterior enquanto o
     * perfil novo nao chegava, e o assistente do paciente abria com a conversa
     * de quem usou antes. O logout limpava algumas dessas chaves na mao, uma a
     * uma, em cada tela - mas a expiracao de sessao nao limpava nenhuma.
     *
     * Varrer por prefixo, aqui no ponto unico de saida, cobre os dois caminhos e
     * qualquer chave nova que apareca seguindo a mesma convencao de nome.
     */
    function clearSession() {
        try {
            sessionStorage.removeItem(CHAVE_TOKEN);
            sessionStorage.removeItem(CHAVE_USER);
            localStorage.removeItem(CHAVE_TOKEN);
            localStorage.removeItem(CHAVE_USER);

            // A lista de chaves e coletada antes de remover: sessionStorage.key(i)
            // reindexa a cada remocao, e apagar durante o laco pula itens.
            var paraRemover = [];
            for (var i = 0; i < sessionStorage.length; i += 1) {
                var chave = sessionStorage.key(i);
                if (!chave) continue;

                for (var j = 0; j < PREFIXOS_DA_SESSAO.length; j += 1) {
                    if (chave.indexOf(PREFIXOS_DA_SESSAO[j]) === 0) {
                        paraRemover.push(chave);
                        break;
                    }
                }
            }

            paraRemover.forEach(function (chave) {
                sessionStorage.removeItem(chave);
            });
        } catch (erro) { /* storage indisponivel */ }
    }

    // -----------------------------------------------------------------------
    // Token
    // -----------------------------------------------------------------------
    /** Le o payload do JWT sem validar a assinatura (quem valida e o servidor). */
    function lerPayload(token) {
        if (!token || typeof token !== 'string') return null;

        var partes = token.split('.');
        if (partes.length !== 3) return null;

        try {
            var base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
            var preenchimento = base64.length % 4 ? 4 - (base64.length % 4) : 0;
            var texto = atob(base64 + new Array(preenchimento + 1).join('='));
            return JSON.parse(texto);
        } catch (erro) {
            return null;
        }
    }

    /** Perfil gravado no proprio token - e ele que o servidor respeita. */
    function getProfile() {
        var payload = lerPayload(getToken());
        return payload && payload.profile ? payload.profile : null;
    }

    /** Segundos restantes ate o token vencer (0 se ja venceu ou nao ha token). */
    function segundosRestantes() {
        var payload = lerPayload(getToken());
        if (!payload || !payload.exp) return 0;

        var restam = payload.exp - Math.floor(Date.now() / 1000);
        return restam > 0 ? restam : 0;
    }

    function isExpired() {
        return !getToken() || segundosRestantes() <= 0;
    }

    // -----------------------------------------------------------------------
    // Encerramento
    // -----------------------------------------------------------------------
    var encerrando = false;

    /**
     * Encerra a sessao e leva para a tela de login certa.
     * @param {'expirada'|'saiu'|'perfil'} motivo
     */
    function encerrarSessao(motivo) {
        if (encerrando) return;
        encerrando = true;

        var perfil = getProfile();
        clearSession();

        var destino = LOGIN_POR_PERFIL[perfil] || LOGIN_PADRAO;
        var separador = destino.indexOf('?') >= 0 ? '&' : '?';
        window.location.replace(destino + separador + 'motivo=' + (motivo || 'expirada'));
    }

    // Dispara o encerramento no exato momento em que o token vence, para o
    // usuario receber um aviso em vez de ver a tela ficar vazia sozinha.
    var temporizador = null;

    function agendarExpiracao() {
        if (temporizador) {
            window.clearTimeout(temporizador);
            temporizador = null;
        }

        var restam = segundosRestantes();
        if (!restam) return;

        // setTimeout satura acima de ~24,8 dias; nossos tokens sao bem menores,
        // mas o limite evita um agendamento que dispararia na hora.
        var atraso = Math.min(restam * 1000, 2147483647);
        temporizador = window.setTimeout(function () {
            if (isExpired()) encerrarSessao('expirada');
        }, atraso);
    }

    // Aba em segundo plano tem o timer estrangulado pelo navegador. Este check
    // cobre justamente o caso relatado: voltar a uma aba deixada de lado.
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        if (getToken() && isExpired()) encerrarSessao('expirada');
    });

    // -----------------------------------------------------------------------
    // Guarda de pagina
    // -----------------------------------------------------------------------
    /**
     * Exige uma sessao valida do perfil esperado. Chamar no topo de cada
     * dashboard. Devolve o usuario ou null (nesse caso ja redirecionou).
     *
     * A checagem de perfil e o que impede uma tela de abrir com a identidade
     * errada, mesmo que um token de outro perfil chegue ao storage.
     *
     * @param {string|string[]} perfisAceitos
     */
    function requireSession(perfisAceitos) {
        var token = getToken();

        if (!token) {
            var destino = LOGIN_POR_PERFIL[[].concat(perfisAceitos)[0]] || LOGIN_PADRAO;
            window.location.replace(destino + '?motivo=login');
            return null;
        }

        if (isExpired()) {
            encerrarSessao('expirada');
            return null;
        }

        var aceitos = [].concat(perfisAceitos).filter(Boolean);
        var perfil = getProfile();

        if (aceitos.length && aceitos.indexOf(perfil) === -1) {
            clearSession();
            var login = LOGIN_POR_PERFIL[aceitos[0]] || LOGIN_PADRAO;
            window.location.replace(login + '?motivo=perfil');
            return null;
        }

        agendarExpiracao();
        return getUser();
    }

    // -----------------------------------------------------------------------
    // Requisicoes autenticadas
    // -----------------------------------------------------------------------
    /**
     * fetch com Authorization e tratamento de 401. O 401 antes passava batido:
     * cada tela tratava a falha como "sem dados" e renderizava vazio.
     */
    function authFetch(url, options) {
        var opcoes = options || {};
        var token = getToken();

        if (token && isExpired()) {
            encerrarSessao('expirada');
            return Promise.reject(new Error('Sessao expirada.'));
        }

        var headers = Object.assign({}, opcoes.headers || {});
        if (token) headers.Authorization = 'Bearer ' + token;

        return fetch(url, Object.assign({}, opcoes, { headers: headers })).then(function (resposta) {
            if (resposta.status === 401) encerrarSessao('expirada');
            return resposta;
        });
    }

    // -----------------------------------------------------------------------
    // Aviso na tela de login
    // -----------------------------------------------------------------------
    var MENSAGENS = {
        expirada: 'Sua sessão expirou. Entre novamente para continuar.',
        perfil: 'Você precisa entrar com uma conta deste tipo para acessar essa área.',
        login: 'Entre na sua conta para acessar essa área.',
        saiu: 'Você saiu da sua conta.'
    };

    function mostrarAvisoDeRetorno() {
        var motivo = new URLSearchParams(window.location.search).get('motivo');
        var texto = MENSAGENS[motivo];
        if (!texto) return;

        // Estilo em theme.css (.session-toast): antes era `style.cssText` com
        // um azul fixo, que ignorava o tema de alto contraste.
        var aviso = document.createElement('div');
        aviso.className = 'session-toast';
        aviso.setAttribute('role', 'status');
        aviso.textContent = texto;

        document.body.appendChild(aviso);
        window.setTimeout(function () { aviso.remove(); }, 6000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mostrarAvisoDeRetorno);
    } else {
        mostrarAvisoDeRetorno();
    }

    agendarExpiracao();

    window.ConectaSession = {
        getToken: getToken,
        getUser: getUser,
        setUser: setUser,
        getProfile: getProfile,
        saveSession: saveSession,
        clearSession: clearSession,
        isExpired: isExpired,
        segundosRestantes: segundosRestantes,
        requireSession: requireSession,
        encerrarSessao: encerrarSessao,
        authFetch: authFetch
    };
})();
