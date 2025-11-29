# SISTEMA DE PONTO CORPORATIVO - PROJETO LW TECH
=====================================

> Versão: 3.0
> Desenvolvido por: [Gabriel Maieski Silva]
> Data: Novembro/2025

## 1. DESCRIÇÃO DO PROJETO
Este é um sistema de registo de ponto eletrónico desenvolvido em tecnologia Web (Single Page Application). O objetivo é permitir que funcionários registrem os seus horários de entrada, pausas e saída de forma simples, e que a gestão tenha acesso a relatórios consolidados.

O sistema funciona inteiramente no navegador, utilizando o "LocalStorage" para guardar os dados, eliminando a necessidade de instalação de servidores complexos para uso básico.

## 2. ARQUIVOS DO PROJETO
Para o sistema funcionar corretamente, a pasta do projeto deve conter:

* `ponto.html` (O código principal do sistema)
* `image_b2e9b6.png` (A logomarca da empresa)
* `LEIA_ME.txt` (Este arquivo de documentação)

## 3. COMO EXECUTAR
1.  Certifique-se de que o arquivo HTML e a imagem estão na mesma pasta.
2.  Dê um duplo clique no arquivo `ponto.html`.
3.  O sistema abrirá automaticamente no seu navegador padrão (Chrome, Edge, Firefox, etc.).

## 4. MANUAL DE USO

### A. Para Funcionários
1.  *Login:*
    * Utilize o seu nome de utilizador (ex: `joao, gabriel`).
    * Digite uma senha.
    * *Nota:* No primeiro acesso, o sistema perguntará se deseja criar uma nova conta. Confirme para se registrar.
2.  *Marcar Ponto:*
    * Clique nos botões coloridos correspondentes à ação (Entrada, Saída, Almoço, etc.).
3.  *Relatório Pessoal:*
    * Clique em "Exportar Meus Pontos" para baixar o seu histórico em formato CSV (compatível com Excel).

### B. Para Administradores (Gestão)
1.  Login Administrativo:
    * Usuário: `admin`
    * Senha: `1234`
2.  Funcionalidades:
    * Visualização do total de registros.
    * Tabela com o histórico de todos os funcionários.
    * Botão "Baixar Relatório Completo" para exportar todos os dados da empresa.

## 5. MANUTENÇÃO TÉCNICA
* *Banco de Dados:* Os dados são salvos no cache do navegador (LocalStorage).
* *Limpeza de Dados:* Para apagar todos os registros e resetar o sistema, abra o Console do Desenvolvedor (F12) e execute o comando: `localStorage.clear()`.
* *Customização:* As cores e o layout podem ser alterados editando as variáveis `:root` no início do arquivo `.html`.

=====================================