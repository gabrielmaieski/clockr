# Clockr — Registro de ponto

[![CI](https://github.com/gabrielmaieski/clockr/actions/workflows/ci.yml/badge.svg)](https://github.com/gabrielmaieski/clockr/actions/workflows/ci.yml)
[![Demo](https://github.com/gabrielmaieski/clockr/actions/workflows/pages.yml/badge.svg)](https://gabrielmaieski.github.io/clockr/)

Sistema web de registro de ponto: funcionários marcam entrada, almoço e saída, e o gestor acompanha a equipe em tempo real e exporta relatórios.

**Demonstração online:** [gabrielmaieski.github.io/clockr](https://gabrielmaieski.github.io/clockr/)

> A demonstração roda só no navegador, com dados de exemplo. Para usar com o banco de dados de verdade, suba o servidor com Docker (veja abaixo).

![Painel do gestor](docs/gestor.png)

## Funcionalidades

**Funcionário**
- Cadastro e login
- Marcação de entrada, saída para almoço, volta e saída, sempre na ordem certa
- Linha do tempo do dia e horas trabalhadas calculadas automaticamente
- Gráfico dos últimos 7 dias e histórico completo
- Exportação do próprio histórico em CSV (abre direto no Excel)

**Gestor**
- Situação da equipe agora: trabalhando, em almoço, encerrou ou sem registro
- Indicadores do dia e horas trabalhadas de cada pessoa
- Registros com filtro por funcionário e data
- Relatório completo em CSV

| Funcionário | Login |
| --- | --- |
| ![Tela do funcionário](docs/funcionario.png) | ![Tela de login](docs/login.png) |

## Arquitetura

```
Navegador (HTML, CSS e JavaScript)
        │
        ├── servidor disponível? ──► API REST (Node.js) ──► SQLite (volume Docker)
        │
        └── sem servidor (GitHub Pages) ──► modo demonstração (IndexedDB no navegador)
```

- **Back-end:** Node.js 22 sem dependências externas, usando os módulos nativos `node:http`, `node:sqlite` e `node:crypto`
- **Banco de dados:** SQLite, com índices e chaves estrangeiras
- **Segurança:** senhas com hash `scrypt` e salt, sessões com token que expiram em 7 dias, limite de tentativas de login e validação de todas as entradas
- **Front-end:** JavaScript puro em módulos, responsivo, com a mesma regra de negócio do servidor (`public/js/core.js`)
- **Infra:** Docker com usuário sem privilégios, volume para o banco e healthcheck
- **CI/CD:** GitHub Actions roda os testes, faz o build e o teste da imagem Docker e publica a demonstração no GitHub Pages

## Como executar

### Com Docker (recomendado)

```bash
git clone https://github.com/gabrielmaieski/clockr.git
cd clockr
ADMIN_PASSWORD=sua-senha docker compose up -d --build
```

Acesse **http://localhost:3000** e entre com o usuário `admin` e a senha definida em `ADMIN_PASSWORD`. Os dados ficam no volume `clockr-data`, então não se perdem ao recriar o container.

### Com Node.js

Requer Node.js 22.13 ou mais recente. Não há nada para instalar.

```bash
ADMIN_PASSWORD=sua-senha npm start
```

### Testes

```bash
npm test
```

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/health` | Status do serviço |
| `POST` | `/api/auth/register` | Cria conta de funcionário |
| `POST` | `/api/auth/login` | Login, retorna o token |
| `POST` | `/api/auth/logout` | Encerra a sessão |
| `GET` | `/api/me` | Usuário atual e situação do dia |
| `GET` | `/api/punches` | Minhas marcações |
| `POST` | `/api/punches` | Registra uma marcação (`entrada`, `saida_almoco`, `volta_almoco`, `saida`) |
| `GET` | `/api/punches/export.csv` | Meu histórico em CSV |
| `GET` | `/api/admin/summary` | Situação da equipe hoje (gestor) |
| `GET` | `/api/admin/punches` | Registros com filtros `user_id` e `date` (gestor) |
| `GET` | `/api/admin/export.csv` | Relatório completo (gestor) |

As rotas protegidas usam o cabeçalho `Authorization: Bearer <token>`.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `ADMIN_PASSWORD` | `admin123` | Senha do usuário `admin`, criado na primeira execução |
| `PORT` | `3000` | Porta do servidor |
| `DB_FILE` | `./data/clockr.db` | Caminho do banco SQLite |
| `APP_TIMEZONE` | `America/Sao_Paulo` | Fuso usado para definir o "dia" das marcações |

## Estrutura

```
clockr/
├── server/            # API: rotas, autenticação e banco
├── public/            # front-end (também publicado no GitHub Pages)
│   └── js/core.js     # regras de negócio compartilhadas
├── test/              # testes com node:test
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/ # CI e deploy da demonstração
```

## Próximos passos

- [ ] Deploy na AWS (EC2 com Docker) com HTTPS
- [ ] Infraestrutura como código com Terraform
- [ ] Ajuste manual de marcações pelo gestor
- [ ] Banco PostgreSQL como opção para produção

---

Desenvolvido por **Gabriel Maieski Silva** · [LinkedIn](https://www.linkedin.com/in/gabrielmaieski) · Projeto iniciado como trabalho acadêmico e reescrito como projeto full stack.
