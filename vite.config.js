import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Injected at the top of the PDF.js worker bundle so these APIs exist on iOS < 15.4
const workerPolyfills = `
if(!Array.prototype.at){Object.defineProperty(Array.prototype,'at',{value:function(n){n=Math.trunc(n)||0;if(n<0)n+=this.length;return(n<0||n>=this.length)?undefined:this[n]},writable:true,configurable:true})}
if(!String.prototype.at){Object.defineProperty(String.prototype,'at',{value:function(n){n=Math.trunc(n)||0;if(n<0)n+=this.length;return(n<0||n>=this.length)?undefined:this[n]},writable:true,configurable:true})}
if(!Object.hasOwn){Object.hasOwn=function(o,k){return Object.prototype.hasOwnProperty.call(o,k)}}
if(typeof structuredClone==='undefined'){self.structuredClone=function(o){return JSON.parse(JSON.stringify(o))}}
`

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'iife',
    plugins: () => [
      {
        name: 'ios-worker-polyfills',
        renderChunk(code) {
          return { code: workerPolyfills + code, map: null }
        },
      },
    ],
  },
})
