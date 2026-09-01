import { getPlaceholderMessage } from '../../shared/placeholder'

const app = document.querySelector<HTMLDivElement>('#app')

if (app) {
  app.innerHTML = `
    <h1>Orca</h1>
    <p>${getPlaceholderMessage()}</p>
  `
}
