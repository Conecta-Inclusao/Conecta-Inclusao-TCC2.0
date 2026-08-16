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

export function validateCNPJ(cnpj) {
  const clean = String(cnpj || "").replace(/\D/g, "");

  if (clean.length !== 14) return false;
  if (clean === clean[0].repeat(14)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(clean[i], 10) * (5 - (i % 4));
  }
  let remainder = sum % 11;
  remainder = remainder < 2 ? 0 : 11 - remainder;
  if (remainder !== parseInt(clean[12], 10)) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(clean[i], 10) * (6 - ((i + 1) % 5));
  }
  remainder = sum % 11;
  remainder = remainder < 2 ? 0 : 11 - remainder;

  return remainder === parseInt(clean[13], 10);
}
