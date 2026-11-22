import '@fontsource-variable/outfit'
import './styles/global.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { MiniApp } from './views/Mini'
import { DataProvider } from './state'

const isMini = location.hash.replace('#', '') === 'mini'
if (isMini) document.documentElement.classList.add('mini')

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DataProvider>{isMini ? <MiniApp /> : <App />}</DataProvider>
  </React.StrictMode>
)
