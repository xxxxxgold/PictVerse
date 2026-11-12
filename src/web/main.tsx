import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '../renderer/src/App'
import '../renderer/src/styles.css'
import { createWebPictVerseAPI } from './web-api'

window.pictverse = createWebPictVerseAPI()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
