// Validacao de digito verificador de CPF/CNPJ.
//
// Estas funcoes vinham de clinica.service.js, que foi removido por ser escrito
// contra um schema inexistente (tabelas `usuarios` e `clinica_especialidades`).
// A logica em si e boa e agora e usada de fato no cadastro.

export function validateCPF(cpf) {
  const clean = String(cpf || "").replace(/\D/g, "");

  if (clean.length !== 11) return false;
  if (clean === clean[0].repeat(11)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean[i], 10) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  remainder = remainder === 10 || remainder === 11 ? 0 : remainder;
  if (remainder !== parseInt(clean[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean[i], 10) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  remainder = remainder === 10 || remainder === 11 ? 0 : remainder;

  return remainder === parseInt(clean[10], 10);
}

// Pesos do digito verificador do CNPJ, na ordem em que multiplicam os digitos.
//
// A versao anterior gerava esses pesos por formula - `5 - (i % 4)` para o
// primeiro digito e `6 - ((i + 1) % 5)` para o segundo. As duas estavam erradas:
// produziam [5,4,3,2,5,4,3,2,...] e [5,4,3,2,6,5,4,3,...], quando a sequencia
// real reinicia em 9 e nao em 5. Efeito pratico: validateCNPJ recusava TODO
// CNPJ valido, e nenhuma clinica conseguia se cadastrar.
//
// Como tabela explicita nao ha o que deduzir errado - e da para conferir contra
// a definicao da Receita olhando os numeros.
const PESOS_CNPJ_PRIMEIRO_DIGITO = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_SEGUNDO_DIGITO = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function digitoVerificadorCNPJ(digitos, pesos) {
  const soma = pesos.reduce(
    (total, peso, indice) => total + parseInt(digitos[indice], 10) * peso,
    0
  );

  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function validateCNPJ(cnpj) {
  const clean = String(cnpj || "").replace(/\D/g, "");

  if (clean.length !== 14) return false;
  if (clean === clean[0].repeat(14)) return false;

  if (digitoVerificadorCNPJ(clean, PESOS_CNPJ_PRIMEIRO_DIGITO) !== parseInt(clean[12], 10)) {
    return false;
  }

  return digitoVerificadorCNPJ(clean, PESOS_CNPJ_SEGUNDO_DIGITO) === parseInt(clean[13], 10);
}
