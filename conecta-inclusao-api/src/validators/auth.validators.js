// Importa a biblioteca Zod, utilizada para validação e tipagem de dados em tempo de execução 
import { z } from "zod"; 
// Exporta um schema de validação para o formulário de login 
// O schema define as regras que os dados do login devem respeitar 
export const loginSchema = z.object({ 
// Define o campo 'email': 
email: z 
// Deve ser uma string 
.string() 
// Remove espaços em branco no início e fim (trim) 
.trim() 
// Converte para minúsculas (toLowerCase) para normalizar o email 
.toLowerCase() 
// Valida se é um formato de email válido (contém @, domínio, etc) 
.email(), 
// Define o campo 'password': 
password: z 
// Deve ser uma string 
.string() 
// Mínimo de 8 caracteres 
.min(8) 
// Máximo de 100 caracteres 
.max(100) 
}); 