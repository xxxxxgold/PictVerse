import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
// 质感与动效增强层：必须在 styles.css 之后引入，靠层叠顺序覆盖
import './ui-polish.css'
import { installUiPolish } from './ui-polish'

installUiPolish()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
