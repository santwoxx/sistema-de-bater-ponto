// Roda antes de publicar o site (predeploy do Hosting, no firebase.json).
// Impede publicar um site que fale com o projeto errado ou com os emuladores:
// o web/.env precisa ser do mesmo projeto do deploy.

import { conferirConfiguracaoDoSite, parar } from './lib.mjs'

const projeto = process.env.GCLOUD_PROJECT
if (!projeto) parar('Este script roda dentro do "firebase deploy" (falta GCLOUD_PROJECT).')
conferirConfiguracaoDoSite(projeto)
console.log(`Configuração do site confere com o projeto ${projeto}.`)
