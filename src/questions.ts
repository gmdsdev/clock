// Temas/instruções sorteados para a IA gerar cada pergunta.
// Todos precisam levar a uma resposta objetiva, verificável e estável.

export const questions: string[] = [
  // Originais (lapidados para ficarem objetivos)
  "Escolha uma pessoa famosa no Brasil (artista, atleta, escritor, cientista ou figura histórica) com data de nascimento amplamente documentada e pergunte em que ano ela nasceu",
  "Escolha um produto da Apple (Macintosh, iPod, iPhone, iPad, Apple Watch, AirPods etc.) e pergunte qual foi o preço de lançamento nos EUA, em dólares, da versão mais barata daquele modelo",
  "Escolha uma capital estadual do Brasil e pergunte quantos habitantes ela tem segundo o Censo 2022 do IBGE",

  // História do Brasil
  "Escolha um acontecimento marcante da história do Brasil (do período colonial à redemocratização) e pergunte em que ano ele ocorreu",
  "Escolha um presidente do Brasil e pergunte em que ano ele assumiu a Presidência pela primeira vez",
  "Escolha uma capital estadual ou cidade histórica do Brasil cuja data oficial de fundação seja consensual e pergunte em que ano ela foi fundada",

  // História mundial
  "Escolha um evento importante da história mundial (guerras, revoluções, tratados, quedas de impérios) com data consensual e pergunte em que ano ele aconteceu",
  "Escolha uma invenção ou descoberta científica famosa com data consensual e pergunte em que ano ela foi patenteada, apresentada ou publicada pela primeira vez",
  "Escolha uma cidade que já sediou os Jogos Olímpicos de Verão e pergunte em que ano ela os sediou pela primeira vez",

  // Geografia
  "Escolha um país (evite os mais óbvios) e pergunte qual é a sua capital oficial",
  "Escolha um país e pergunte qual é a sua moeda oficial atual, evitando países que mudaram de moeda nos últimos 20 anos",
  "Escolha uma das montanhas mais altas de algum continente e pergunte qual é a sua altitude, em metros",
  "Escolha um estado brasileiro e pergunte qual é a sua área territorial, em km², segundo o IBGE",
  "Escolha um país que tenha um único idioma oficial e pergunte qual é esse idioma",

  // Ciência
  "Escolha um elemento químico da tabela periódica e pergunte qual é o seu número atômico",
  "Escolha um elemento químico e pergunte qual é o seu símbolo na tabela periódica",
  "Escolha uma substância comum (água, etanol, mercúrio, ferro, ouro, nitrogênio...) e pergunte o seu ponto de fusão ou de ebulição ao nível do mar, em graus Celsius",
  "Escolha uma constante ou grandeza física famosa (velocidade da luz no vácuo, velocidade do som no ar, aceleração da gravidade na Terra...) e pergunte o seu valor, deixando a unidade explícita",
  "Escolha um fato numérico clássico do corpo humano (ossos do adulto, dentes permanentes, pares de cromossomos, câmaras do coração, vértebras...) e pergunte esse número",
  "Escolha um animal vertebrado que costuma confundir (golfinho, morcego, pinguim, ornitorrinco, salamandra, cavalo-marinho...) e pergunte a qual classe de vertebrados ele pertence (a resposta deve ser mamíferos, aves, répteis, anfíbios ou peixes; não liste as opções na pergunta)",
  "Escolha uma lei, teoria ou descoberta científica famosa atribuída a uma única pessoa e pergunte quem a formulou ou realizou",

  // Astronomia
  "Escolha uma missão espacial histórica (Sputnik 1, Vostok 1, Apollo 11, Voyager 1, Hubble...) e pergunte em que ano ela foi lançada",
  "Escolha um planeta do Sistema Solar e pergunte quanto tempo ele leva para completar uma volta ao redor do Sol, em dias terrestres ou anos terrestres (deixe claro qual)",
  "Escolha uma característica marcante e única de um planeta do Sistema Solar (o maior, o mais quente, o que tem a Grande Mancha Vermelha, o que gira 'deitado'...) e pergunte qual planeta é",

  // Futebol e esportes
  "Escolha uma edição da Copa do Mundo FIFA masculina e pergunte qual seleção foi campeã",
  "Escolha uma edição da Copa do Mundo FIFA masculina com um único país-sede e pergunte qual país a sediou",
  "Escolha um título marcante de um clube, seleção ou atleta brasileiro (Libertadores, Mundial, Fórmula 1, medalha olímpica de ouro) e pergunte em que ano foi conquistado; se houver mais de um, pergunte pelo primeiro",
  "Escolha um esporte coletivo ou olímpico e pergunte uma regra numérica oficial (jogadores de cada equipe em quadra ou campo, sets para vencer, duração regulamentar em minutos)",

  // Música
  "Escolha uma música muito famosa da MPB, bossa nova, samba ou rock nacional e pergunte qual artista ou banda a lançou originalmente",
  "Escolha um álbum clássico da música brasileira ou internacional e pergunte em que ano ele foi lançado",
  "Escolha um instrumento musical e pergunte quantas cordas ou teclas ele tem na sua versão padrão",

  // Cinema
  "Escolha um filme muito famoso (clássico ou blockbuster) e pergunte quem o dirigiu",
  "Escolha um filme brasileiro famoso (Central do Brasil, Cidade de Deus, Tropa de Elite, O Auto da Compadecida...) e pergunte quem o dirigiu",
  "Escolha um personagem famoso do cinema e pergunte qual ator ou atriz o interpretou em um filme específico, citando o título e o ano do filme",
  "Escolha um filme vencedor do Oscar de Melhor Filme e pergunte em que ano foi realizada a cerimônia em que ele venceu",

  // Literatura
  "Escolha uma obra clássica da literatura brasileira e pergunte quem a escreveu",
  "Escolha uma obra clássica da literatura mundial e pergunte quem a escreveu",
  "Escolha um livro clássico e pergunte em que ano ele foi publicado pela primeira vez",

  // Tecnologia
  "Escolha uma grande empresa de tecnologia (Apple, Microsoft, Google, Amazon, Nintendo, Samsung, IBM...) e pergunte em que ano ela foi fundada",
  "Escolha uma linguagem de programação conhecida e pergunte quem a criou, apenas se houver um criador principal reconhecido",
  "Escolha um console de videogame ou computador pessoal clássico e pergunte em que ano ele foi lançado, indicando o país ou região do lançamento",
  "Escolha um fato numérico fixo da computação (bits em um byte, código ASCII de um caractere, porta padrão de um protocolo, potências de 2) e pergunte esse número",

  // Cálculo mental (100% verificável)
  "Crie uma multiplicação de dois números de dois dígitos entre 12 e 99, sem múltiplos de 10, e pergunte o resultado",
  "Crie uma conta de porcentagem com resultado inteiro (X% de Y, com X entre 5 e 95 e Y entre 100 e 2000) e pergunte o resultado",
  "Escolha um quadrado perfeito entre 144 e 961 e pergunte qual é a sua raiz quadrada",
  "Crie uma expressão com três operações (soma, subtração, multiplicação e divisão exata), sem parênteses, cujo resultado inteiro dependa de respeitar a precedência, e pergunte o resultado",
  "Crie uma soma ou subtração de dois números de três ou quatro dígitos e pergunte o resultado",
  "Crie uma potência com base entre 2 e 12 e expoente entre 2 e 5, com resultado menor que 100.000, e pergunte o resultado",
  "Crie um problema curto do cotidiano (troco em reais, idade, divisão de conta, duração em minutos) com uma única resposta numérica inteira; nunca pergunte horário do relógio (a resposta deve ser só um número)",
];
