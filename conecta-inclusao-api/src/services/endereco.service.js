// Consulta de CEP (ViaCEP) e geocodificacao (Nominatim/OpenStreetMap).
//
// POR QUE ISTO MORA NO SERVIDOR
//
// 1. CSP. A politica definida em app.js usa `connectSrc: ['self', 'ws:', 'wss:']`.
//    Quando o front e servido pela propria API, qualquer fetch do navegador para
//    viacep.com.br ou nominatim.openstreetmap.org e bloqueado antes de sair. Era
//    exatamente o caso do cadastro de clinica, que chamava o ViaCEP direto do
//    browser e so funcionava porque a Vercel serve o front sem CSP.
//
// 2. Politica do Nominatim. O servico exige um User-Agent identificando a
//    aplicacao e limita a 1 requisicao por segundo. O navegador nao pode definir
//    User-Agent, e o limite so e respeitavel a partir de um ponto unico.
//
// 3. Cache. Um CEP consultado uma vez vale para todos os usuarios; guardar em
//    memoria evita repetir a chamada externa a cada digitacao.
import { setTimeout as sleep } from "node:timers/promises";

const VIACEP_URL = "https://viacep.com.br/ws";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// O Nominatim pede identificacao de contato no User-Agent. Sem isso as
// requisicoes sao recusadas com 403 sem aviso claro.
const USER_AGENT = "ConectaInclusao/1.0 (TCC; contato via github.com/conecta-inclusao)";

const TEMPO_LIMITE_MS = 6000;

// Cache simples em memoria. O conteudo (CEP -> endereco, endereco -> coordenada)
// e estavel o bastante para nao precisar de invalidacao por tempo curto.
const cacheCep = new Map();
const cacheCoordenadas = new Map();
const LIMITE_CACHE = 500;

function guardarNoCache(cache, chave, valor) {
  if (cache.size >= LIMITE_CACHE) {
    // Descarta a entrada mais antiga: Map preserva a ordem de insercao.
    cache.delete(cache.keys().next().value);
  }
  cache.set(chave, valor);
}

export function apenasDigitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

export function normalizarCep(valor) {
  const digitos = apenasDigitos(valor);
  return digitos.length === 8 ? digitos : null;
}

export function formatarCep(valor) {
  const digitos = normalizarCep(valor);
  return digitos ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : null;
}

async function buscarComTempoLimite(url, opcoes = {}) {
  const controlador = new AbortController();
  const timer = globalThis.setTimeout(() => controlador.abort(), TEMPO_LIMITE_MS);

  try {
    return await fetch(url, { ...opcoes, signal: controlador.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/**
 * Endereco a partir do CEP, via ViaCEP.
 * @returns {Promise<{ok: true, data: object} | {ok: false, statusCode: number, message: string}>}
 */
export async function buscarEnderecoPorCep(cep) {
  const digitos = normalizarCep(cep);

  if (!digitos) {
    return { ok: false, statusCode: 400, message: "CEP invalido. Informe 8 digitos." };
  }

  if (cacheCep.has(digitos)) {
    return { ok: true, data: cacheCep.get(digitos) };
  }

  try {
    const resposta = await buscarComTempoLimite(`${VIACEP_URL}/${digitos}/json/`, {
      headers: { "User-Agent": USER_AGENT }
    });

    if (!resposta.ok) {
      return { ok: false, statusCode: 502, message: "Nao foi possivel consultar o CEP agora." };
    }

    const corpo = await resposta.json();

    // O ViaCEP responde 200 com { erro: true } para CEP inexistente.
    if (corpo?.erro) {
      return { ok: false, statusCode: 404, message: "CEP nao encontrado." };
    }

    const endereco = {
      cep: formatarCep(corpo.cep) || formatarCep(digitos),
      logradouro: corpo.logradouro || "",
      bairro: corpo.bairro || "",
      cidade: corpo.localidade || "",
      estado: String(corpo.uf || "").toUpperCase()
    };

    guardarNoCache(cacheCep, digitos, endereco);
    return { ok: true, data: endereco };
  } catch (erro) {
    if (erro.name === "AbortError") {
      return { ok: false, statusCode: 504, message: "A consulta de CEP demorou demais. Tente de novo." };
    }

    console.error("Erro ao consultar o ViaCEP:", erro);
    return { ok: false, statusCode: 502, message: "Nao foi possivel consultar o CEP agora." };
  }
}

// O Nominatim aceita no maximo 1 requisicao por segundo. Esta fila serializa as
// chamadas e garante o intervalo, em vez de disparar varias em paralelo e ser
// bloqueado.
let ultimaChamadaNominatim = 0;
let filaNominatim = Promise.resolve();

function enfileirarNominatim(tarefa) {
  const proxima = filaNominatim.then(async () => {
    const desdeUltima = Date.now() - ultimaChamadaNominatim;
    if (desdeUltima < 1100) {
      await sleep(1100 - desdeUltima);
    }
    ultimaChamadaNominatim = Date.now();
    return tarefa();
  });

  // A fila nao pode ser interrompida por uma falha isolada.
  filaNominatim = proxima.catch(() => {});
  return proxima;
}

function chaveDeCoordenada(endereco) {
  return [
    endereco.logradouro,
    endereco.numero,
    endereco.bairro,
    endereco.cidade,
    endereco.estado,
    normalizarCep(endereco.cep)
  ]
    .map((parte) => String(parte || "").trim().toLowerCase())
    .join("|");
}

/**
 * Latitude/longitude de um endereco, via Nominatim.
 *
 * Faz ate duas tentativas: primeiro o endereco completo (com numero), depois so
 * a rua/bairro/cidade. Endereco sem numero, ou com numero que o OSM nao conhece,
 * ainda produz uma coordenada boa o suficiente para ordenar unidades por
 * distancia - que e o unico uso dessa coordenada aqui.
 *
 * @returns {Promise<{latitude: number, longitude: number} | null>}
 */
export async function geocodificarEndereco(endereco) {
  const chave = chaveDeCoordenada(endereco);
  if (cacheCoordenadas.has(chave)) {
    return cacheCoordenadas.get(chave);
  }

  const cidadeEstado = [endereco.cidade, endereco.estado].filter(Boolean).join(", ");
  const ruaComNumero = [endereco.logradouro, endereco.numero].filter(Boolean).join(", ");

  const tentativas = [
    [ruaComNumero, endereco.bairro, cidadeEstado, "Brasil"],
    [endereco.logradouro, endereco.bairro, cidadeEstado, "Brasil"],
    [cidadeEstado, "Brasil"]
  ]
    .map((partes) => partes.filter(Boolean).join(", "))
    .filter((consulta, indice, lista) => consulta && lista.indexOf(consulta) === indice);

  for (const consulta of tentativas) {
    try {
      const coordenada = await enfileirarNominatim(async () => {
        const url = new URL(NOMINATIM_URL);
        url.searchParams.set("q", consulta);
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("limit", "1");
        url.searchParams.set("countrycodes", "br");

        const resposta = await buscarComTempoLimite(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
        });

        if (!resposta.ok) return null;

        const resultados = await resposta.json();
        const primeiro = Array.isArray(resultados) ? resultados[0] : null;
        if (!primeiro) return null;

        const latitude = Number(primeiro.lat);
        const longitude = Number(primeiro.lon);

        return Number.isFinite(latitude) && Number.isFinite(longitude)
          ? { latitude, longitude }
          : null;
      });

      if (coordenada) {
        guardarNoCache(cacheCoordenadas, chave, coordenada);
        return coordenada;
      }
    } catch (erro) {
      if (erro.name !== "AbortError") {
        console.error("Erro ao geocodificar endereco:", erro);
      }
    }
  }

  guardarNoCache(cacheCoordenadas, chave, null);
  return null;
}

/**
 * Resolve endereco + coordenadas a partir de um CEP (ou de campos manuais,
 * quando o usuario marca "nao sei meu CEP").
 *
 * `manual` tem prioridade sobre o que o ViaCEP devolve: em CEP de logradouro
 * unico o ViaCEP retorna a rua vazia, e quem sabe o endereco e o usuario.
 */
export async function resolverEndereco({ cep = null, manual = null } = {}) {
  let base = {
    cep: formatarCep(cep),
    logradouro: "",
    numero: "",
    bairro: "",
    cidade: "",
    estado: ""
  };

  if (normalizarCep(cep)) {
    const consulta = await buscarEnderecoPorCep(cep);
    if (!consulta.ok) return consulta;
    base = { ...base, ...consulta.data };
  }

  if (manual) {
    for (const campo of ["logradouro", "numero", "bairro", "cidade", "estado"]) {
      const valor = String(manual[campo] ?? "").trim();
      if (valor) base[campo] = campo === "estado" ? valor.toUpperCase() : valor;
    }
    if (!base.cep && manual.cep) base.cep = formatarCep(manual.cep);
  }

  if (!base.cidade || !base.estado) {
    return {
      ok: false,
      statusCode: 400,
      message: "Endereco incompleto: cidade e estado sao obrigatorios."
    };
  }

  const coordenada = await geocodificarEndereco(base);

  return {
    ok: true,
    data: {
      ...base,
      latitude: coordenada?.latitude ?? null,
      longitude: coordenada?.longitude ?? null,
      // Distingue "nao consegui geocodificar" de "endereco invalido": o cadastro
      // segue mesmo sem coordenada, apenas sem ordenacao por distancia.
      geocodificado: Boolean(coordenada)
    }
  };
}

/**
 * Distancia em quilometros entre dois pontos (formula de haversine).
 * Usada no fallback em JS; a ordenacao das unidades e feita no proprio SQL.
 */
export function distanciaEmKm(origem, destino) {
  if (!origem || !destino) return null;

  const raioTerra = 6371;
  const paraRadianos = (grau) => (grau * Math.PI) / 180;

  const deltaLat = paraRadianos(destino.latitude - origem.latitude);
  const deltaLon = paraRadianos(destino.longitude - origem.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(paraRadianos(origem.latitude)) *
      Math.cos(paraRadianos(destino.latitude)) *
      Math.sin(deltaLon / 2) ** 2;

  return raioTerra * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
