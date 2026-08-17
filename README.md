# 🏥 Conecta Inclusão

Plataforma digital voltada para conectar **médicos, clínicas e consultórios** a **crianças e adolescentes com deficiência (PCDs)**, facilitando o acesso a consultas online e promovendo inclusão na área da saúde.

---

## 📌 Problema

Crianças e adolescentes com deficiência (PCDs) enfrentam dificuldades no acesso a serviços de saúde, como:

* Falta de profissionais especializados
* Dificuldade de deslocamento até clínicas
* Pouca integração entre pacientes e médicos
* Barreiras digitais e sociais

Esses desafios dificultam o acompanhamento médico contínuo e de qualidade.

---

## 💡 Solução

O **Conecta Inclusão** propõe uma plataforma digital que conecta pacientes PCDs a médicos e clínicas parceiras, permitindo:

* Realização de consultas online
* Agendamento de atendimentos
* Acompanhamento médico contínuo
* Comunicação facilitada entre pacientes e profissionais

---

## 🎯 Público-alvo

* Crianças e adolescentes com deficiência (PCDs)
* Responsáveis legais (pais ou cuidadores)
* Médicos de diversas especialidades
* Clínicas e consultórios parceiros

---

## ⚙️ Funcionalidades

### 👨‍⚕️ Perfil do Médico

* 📅 Gerenciamento de agenda
* 💬 Realização de consultas online
* 📝 Registro de relatórios médicos
* 📊 Histórico de atendimentos

### 🧑‍🦽 Perfil do Paciente

* 🔍 Busca por médicos e clínicas
* 📅 Agendamento de consultas
* 💬 Participação em consultas online
* 📄 Acesso ao histórico e relatórios

### 🏥 Plataforma

* Integração com clínicas parceiras
* Sistema de conexão entre usuários
* Organização de atendimentos

---

## ♿ Acessibilidade (Diferencial do Projeto)

A plataforma foi projetada com foco em inclusão digital. Em **todas as telas**
há um botão flutuante **"Acessibilidade"** que abre um painel com três ajustes,
gravados no navegador e reaplicados nas próximas visitas:

* **Tamanho do texto** — 100%, 112% ou 125% (a interface inteira acompanha,
  porque os tamanhos são definidos em `rem`)
* **Alto contraste** — tema preto/amarelo, acima da relação exigida pela WCAG AAA
* **Animações reduzidas** — para quem tem sensibilidade a movimento
  (a preferência do sistema, `prefers-reduced-motion`, também é respeitada)

Além disso, valem para o front inteiro:

* link **"Pular para o conteúdo"** como primeiro item tabulável de cada página
* foco visível em todo campo, botão e link (antes o CSS apagava o contorno)
* alvos de toque de no mínimo 44 px
* rótulos associados a todos os campos e ícones marcados como decorativos
* corpo de texto a partir de 16 px, evitando o zoom automático do iOS

---

## 🎨 Front-end

O front é HTML/CSS/JS puro, sem framework, organizado como um pequeno sistema
de design em vez de uma folha de estilo por página:

```
assets/css/
  theme.css        Tokens (cor, tipografia, espaço, raio, sombra), reset,
                   botões, campos, selos, modais, alto contraste
  auth.css         Telas de login e cadastro
  dashboard.css    Casco comum dos três painéis (barra lateral, topo,
                   cartões, tabelas, chat, modais)
  <pagina>.css     Só o que é exclusivo daquela tela
  responsive.css   Rede de segurança global (carregado por último)
```

Cada perfil tem uma cor de acento própria — **azul** para o paciente,
**verde-água** para o profissional e **âmbar** para a clínica —, aplicada por
uma variável CSS que os componentes leem. A cor acompanha a pessoa do login até
o painel, funcionando como pista de "onde estou".

---

## 🧱 Arquitetura do Sistema

O sistema segue uma arquitetura em camadas:

Usuário → Frontend → Backend (API REST + WebSocket) → Banco de Dados

### 📂 Estrutura do Projeto

```
conecta-inclusao-api/          Backend (Node.js + Express)
  src/
    env.js                     Carrega e valida variáveis de ambiente (falha no boot se faltar)
    app.js                     Middlewares, CORS, rotas e arquivos estáticos
    server.js                  Sobe o servidor HTTP
    realtime.js                Socket.io com handshake autenticado por JWT
    db.js                      Pool PostgreSQL (adapta placeholders `?` para `$n`)
    routes/                    Rotas HTTP
    services/                  Regras de negócio e acesso a dados
    validators/                Schemas Zod
    utils/                     Validação de CPF/CNPJ

conecta-inclusao-front/        Frontend (HTML/CSS/JS puro)
  src/pages/                   Páginas
  src/assets/css/              Sistema de design (theme.css é a base)
  src/assets/js/               Scripts (realtime-chat.js é o cliente do chat,
                               acessibilidade.js é o painel de preferências)
  scripts/generate-config.js   Gera src/assets/js/config.js no build

Banco de dados.sql             Schema PostgreSQL canônico
```

---

## 🛠️ Tecnologias Utilizadas

### Backend

* Node.js + Express 5
* PostgreSQL (Neon) via `pg`
* Socket.io (chat em tempo real, autenticado por JWT)
* JWT + bcrypt para autenticação
* Zod para validação
* Helmet, CORS por allowlist e rate limiting
* Nodemailer para recuperação de senha

### Frontend

* HTML / CSS / JavaScript (sem framework)
* socket.io-client servido pelo próprio backend

---

## ▶️ Como Executar o Projeto

### 🔧 Pré-requisitos

* Node.js 18+
* Um banco PostgreSQL (local ou Neon)
* npm

---

### 📥 Passos para execução

```bash
# Clonar o repositório
git clone https://github.com/MatheusLima022/Conecta-Inclusao-TCC2.0.git
cd Conecta-Inclusao-TCC2.0

# Instalar dependências da API
cd conecta-inclusao-api
npm install

# Configurar o ambiente
cp .env.exemple .env
# Preencha DATABASE_URL e gere um JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Subir a API (serve também o front em http://localhost:3000)
npm run dev
```

> A API **não inicia** sem `JWT_SECRET` (mínimo 32 caracteres) e `DATABASE_URL`.
> Isso é proposital: antes existia um segredo padrão no código, e a aplicação
> subia em produção assinando tokens com uma chave pública.

---

### 🗄️ Configuração do Banco de Dados

1. Crie um banco PostgreSQL (ou um projeto no [Neon](https://neon.tech))
2. Execute o script `Banco de dados.sql` nele
3. Coloque a connection string em `DATABASE_URL` no `.env`

---

## 💬 Chat em tempo real

O chat entre paciente e médico usa Socket.io com autorização no servidor:

* o **handshake exige o mesmo JWT** usado no REST — conexão sem token é recusada;
* o cliente informa **com quem** quer falar (`targetProfileId`), nunca em qual sala entrar;
* o servidor resolve a sala a partir de um **atendimento real** entre as duas partes;
* toda mensagem é persistida em `mensagens` e passa pela mesma autorização do REST;
* se o WebSocket cair, o front continua funcionando via REST (`/messages`).

Sem um agendamento ligando paciente e médico, não existe conversa.

---

## 📊 Metodologia

O desenvolvimento do projeto seguiu:

* Levantamento de requisitos
* Modelagem do sistema
* Implementação incremental
* Testes funcionais

---

## 📈 Resultados Esperados

* Facilitar o acesso à saúde para PCDs
* Reduzir barreiras geográficas
* Promover inclusão digital na área médica
* Melhorar o acompanhamento clínico

---

## 🔍 Trabalhos Futuros

* Implementação de videochamadas integradas
* Sistema de recomendação de médicos
* Aplicativo mobile
* Auditoria de acessibilidade com usuários reais e leitores de tela
* Suíte de testes automatizados (o projeto ainda não possui testes)
* Auditoria de acesso a dados sensíveis (exigência prática de LGPD para dados de saúde)


---

## 🌐 Demonstração

👉 (Adicionar link do sistema online)

---

## 🎥 Vídeo de Apresentação

👉 (Adicionar link do vídeo)

---

## 👨‍💻 Autores

* Matheus Couto da Costa Lima
* Miguel Rezende Gomes
* Natan Belo da Cruz Silva
* Thais Vitoria Ferraz Rangel
* Wilian Braz dos Santos

---

## 🔗 LinkedIn dos Autores

*(Adicionar os links abaixo)*

* Matheus Couto da Costa Lima – (link)
* Miguel Rezende Gomes – (link)
* Natan Belo da Cruz Silva – (link)
* Thais Vitoria Ferraz Rangel – (link)
* Wilian Braz dos Santos – (link)

---

## 📄 Licença

Projeto desenvolvido para fins acadêmicos como Trabalho de Conclusão de Curso (TCC).

