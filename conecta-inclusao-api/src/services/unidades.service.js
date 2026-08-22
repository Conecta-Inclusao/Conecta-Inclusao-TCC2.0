// Unidades (filiais) da clinica.
//
// Antes "unidade" era uma string fixa no HTML ("Unidade A/B/C") gravada em
// medicos.unidade. Sem endereco nao havia como responder a pergunta que a
// clinica faz no cadastro de um medico: qual das minhas unidades fica mais
// perto dele? Agora cada unidade tem CEP e coordenada, e a combobox do cadastro
// e ordenada por distancia real.
import { pool } from "../db.js";
import { resolverEndereco, formatarCep } from "./endereco.service.js";

// Raio medio da Terra em km, usado na haversine feita no proprio SQL.
const RAIO_TERRA_KM = 6371;

const COLUNAS_PUBLICAS = `
  id,
  clinica_id AS "clinicaId",
  nome,
  cep,
  logradouro,
  numero,
  bairro,
  cidade,
  estado,
  latitude::float8 AS latitude,
  longitude::float8 AS longitude,
  ativo
`;

/**
 * Haversine em SQL. Fica aqui como string para nao repetir a formula nas duas
 * consultas que precisam dela.
 *
 * As colunas latitude/longitude sao NUMERIC; o cast para float8 e necessario
 * porque as funcoes trigonometricas do Postgres nao aceitam NUMERIC.
 */
const DISTANCIA_SQL = `
  CASE
    WHEN u.latitude IS NULL OR u.longitude IS NULL THEN NULL
    ELSE ${RAIO_TERRA_KM} * 2 * asin(
      sqrt(
        power(sin(radians(u.latitude::float8 - ?) / 2), 2) +
        cos(radians(?)) * cos(radians(u.latitude::float8)) *
        power(sin(radians(u.longitude::float8 - ?) / 2), 2)
      )
    )
  END
`;

export async function listarUnidades(clinicaId, { apenasAtivas = false } = {}) {
  const condicoes = ["clinica_id = ?"];
  const valores = [clinicaId];

  if (apenasAtivas) {
    condicoes.push("ativo = TRUE");
  }

  const [linhas] = await pool.execute(
    `SELECT ${COLUNAS_PUBLICAS}
     FROM unidades
     WHERE ${condicoes.join(" AND ")}
     ORDER BY nome ASC`,
    valores
  );

  return linhas;
}

/**
 * Unidades da clinica ordenadas pela distancia ate um ponto.
 *
 * Unidades sem coordenada nao somem da lista - apenas vao para o fim, com
 * distancia nula. Some-las seria pior: a clinica deixaria de enxergar uma
 * unidade sua so porque a geocodificacao falhou.
 */
export async function listarUnidadesPorDistancia(clinicaId, ponto) {
  if (!ponto || !Number.isFinite(ponto.latitude) || !Number.isFinite(ponto.longitude)) {
    const unidades = await listarUnidades(clinicaId, { apenasAtivas: true });
    return unidades.map((unidade) => ({ ...unidade, distanciaKm: null }));
  }

  // A ordem dos valores segue a ordem em que os `?` aparecem no texto final:
  // os tres de DISTANCIA_SQL vem antes do filtro por clinica.
  const [linhas] = await pool.execute(
    `SELECT u.id,
            u.clinica_id AS "clinicaId",
            u.nome,
            u.cep,
            u.logradouro,
            u.numero,
            u.bairro,
            u.cidade,
            u.estado,
            u.latitude::float8 AS latitude,
            u.longitude::float8 AS longitude,
            u.ativo,
            ${DISTANCIA_SQL} AS "distanciaKm"
     FROM unidades u
     WHERE u.clinica_id = ? AND u.ativo = TRUE
     ORDER BY "distanciaKm" ASC NULLS LAST, u.nome ASC`,
    [ponto.latitude, ponto.latitude, ponto.longitude, clinicaId]
  );

  return linhas;
}

export async function buscarUnidade(clinicaId, unidadeId) {
  const [linhas] = await pool.execute(
    `SELECT ${COLUNAS_PUBLICAS}
     FROM unidades
     WHERE id = ? AND clinica_id = ?
     LIMIT 1`,
    [unidadeId, clinicaId]
  );

  return linhas[0] || null;
}

/**
 * Cria uma unidade a partir do CEP (ou dos campos manuais, quando a clinica
 * marca "nao sei o CEP"). A geocodificacao acontece aqui, uma unica vez - e
 * nao a cada cadastro de medico.
 */
export async function criarUnidade(clinicaId, dados) {
  const nome = String(dados.nome || "").trim();

  if (!nome) {
    return { ok: false, statusCode: 400, message: "Informe o nome da unidade." };
  }

  const endereco = await resolverEndereco({
    cep: dados.cep,
    manual: {
      logradouro: dados.logradouro,
      numero: dados.numero,
      bairro: dados.bairro,
      cidade: dados.cidade,
      estado: dados.estado,
      cep: dados.cep
    }
  });

  if (!endereco.ok) return endereco;

  try {
    const [resultado] = await pool.execute(
      `INSERT INTO unidades (clinica_id, nome, cep, logradouro, numero, bairro, cidade, estado, latitude, longitude, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
       RETURNING id`,
      [
        clinicaId,
        nome,
        endereco.data.cep,
        endereco.data.logradouro || null,
        endereco.data.numero || null,
        endereco.data.bairro || null,
        endereco.data.cidade,
        endereco.data.estado,
        endereco.data.latitude,
        endereco.data.longitude
      ]
    );

    const id = resultado.rows?.[0]?.id ?? resultado.insertId;
    const unidade = await buscarUnidade(clinicaId, id);

    return {
      ok: true,
      statusCode: 201,
      data: { ...unidade, geocodificado: endereco.data.geocodificado }
    };
  } catch (erro) {
    if (erro.code === "23505") {
      return { ok: false, statusCode: 409, message: "Ja existe uma unidade com esse nome nesta clinica." };
    }

    console.error("Erro ao criar unidade:", erro);
    return { ok: false, statusCode: 500, message: "Erro ao cadastrar a unidade." };
  }
}

export async function atualizarUnidade(clinicaId, unidadeId, dados) {
  const atual = await buscarUnidade(clinicaId, unidadeId);
  if (!atual) {
    return { ok: false, statusCode: 404, message: "Unidade nao encontrada nesta clinica." };
  }

  const nome = dados.nome === undefined ? atual.nome : String(dados.nome || "").trim();
  if (!nome) {
    return { ok: false, statusCode: 400, message: "Informe o nome da unidade." };
  }

  // So refaz a geocodificacao quando o endereco mudou de fato: o Nominatim tem
  // limite de 1 requisicao por segundo, entao nao vale gastar uma chamada para
  // renomear uma unidade.
  const enderecoMudou = ["cep", "logradouro", "numero", "bairro", "cidade", "estado"]
    .some((campo) => dados[campo] !== undefined);

  let endereco = {
    cep: atual.cep,
    logradouro: atual.logradouro,
    numero: atual.numero,
    bairro: atual.bairro,
    cidade: atual.cidade,
    estado: atual.estado,
    latitude: atual.latitude,
    longitude: atual.longitude,
    geocodificado: atual.latitude !== null && atual.longitude !== null
  };

  if (enderecoMudou) {
    const resolvido = await resolverEndereco({
      cep: dados.cep ?? atual.cep,
      manual: {
        logradouro: dados.logradouro ?? atual.logradouro,
        numero: dados.numero ?? atual.numero,
        bairro: dados.bairro ?? atual.bairro,
        cidade: dados.cidade ?? atual.cidade,
        estado: dados.estado ?? atual.estado,
        cep: dados.cep ?? atual.cep
      }
    });

    if (!resolvido.ok) return resolvido;
    endereco = resolvido.data;
  }

  try {
    await pool.execute(
      `UPDATE unidades
       SET nome = ?, cep = ?, logradouro = ?, numero = ?, bairro = ?, cidade = ?, estado = ?,
           latitude = ?, longitude = ?, ativo = ?
       WHERE id = ? AND clinica_id = ?`,
      [
        nome,
        formatarCep(endereco.cep),
        endereco.logradouro || null,
        endereco.numero || null,
        endereco.bairro || null,
        endereco.cidade,
        endereco.estado,
        endereco.latitude,
        endereco.longitude,
        dados.ativo === undefined ? atual.ativo : Boolean(dados.ativo),
        unidadeId,
        clinicaId
      ]
    );

    // medicos.unidade guarda o nome por texto: renomear a unidade sem atualizar
    // os medicos deixaria a equipe apontando para um nome que nao existe mais.
    if (nome !== atual.nome) {
      await pool.execute(
        `UPDATE medicos SET unidade = ? WHERE unidade_id = ? AND clinica_id = ?`,
        [nome, unidadeId, clinicaId]
      );
    }

    const unidade = await buscarUnidade(clinicaId, unidadeId);
    return { ok: true, statusCode: 200, data: { ...unidade, geocodificado: endereco.geocodificado } };
  } catch (erro) {
    if (erro.code === "23505") {
      return { ok: false, statusCode: 409, message: "Ja existe uma unidade com esse nome nesta clinica." };
    }

    console.error("Erro ao atualizar unidade:", erro);
    return { ok: false, statusCode: 500, message: "Erro ao atualizar a unidade." };
  }
}

/**
 * Desativa a unidade em vez de apagar. Apagar tiraria a referencia historica
 * dos medicos ja vinculados a ela (o FK e ON DELETE SET NULL).
 */
export async function desativarUnidade(clinicaId, unidadeId) {
  const [resultado] = await pool.execute(
    `UPDATE unidades SET ativo = FALSE WHERE id = ? AND clinica_id = ?`,
    [unidadeId, clinicaId]
  );

  if (!resultado.affectedRows) {
    return { ok: false, statusCode: 404, message: "Unidade nao encontrada nesta clinica." };
  }

  return { ok: true, statusCode: 200, message: "Unidade desativada." };
}

/**
 * Primeira unidade da clinica, criada a partir do endereco do proprio cadastro.
 * Chamada quando a clinica abre a aba de unidades e ainda nao tem nenhuma - sem
 * isso a combobox do cadastro de medico nasceria vazia.
 */
export async function garantirUnidadePrincipal(clinicaId) {
  const existentes = await listarUnidades(clinicaId);
  if (existentes.length) return existentes;

  const [linhas] = await pool.execute(
    `SELECT nome, endereco, cidade, estado, cep FROM clinicas WHERE id = ? LIMIT 1`,
    [clinicaId]
  );

  const clinica = linhas[0];
  if (!clinica || (!clinica.cep && !clinica.cidade)) return existentes;

  const criada = await criarUnidade(clinicaId, {
    nome: "Unidade Principal",
    cep: clinica.cep,
    logradouro: clinica.endereco,
    cidade: clinica.cidade,
    estado: clinica.estado
  });

  // 409 aqui significa que outra requisicao criou a unidade principal enquanto
  // esta geocodificava - a tela da clinica carrega a lista por dois caminhos ao
  // mesmo tempo (aba Unidades e combobox do cadastro de medico), e os dois
  // passam por aqui. Nesse caso a resposta certa e a lista que ja existe, nao
  // uma lista vazia.
  if (!criada.ok) {
    return criada.statusCode === 409 ? listarUnidades(clinicaId) : existentes;
  }

  return [criada.data];
}
