#!/usr/bin/env node
const path = require('path')
const { Readable } = require('stream')
const koa = require('koa')
const send = require('koa-send')
const compilerSFC = require('@vue/compiler-sfc')

const app = new koa()

const streamToString = stream => new Promise((resolve, reject) => {
  const chunks = []
  stream.on('data', chunk => chunks.push(chunk))
  stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
  stream.on('error', reject)
})

const stringToStream = text => {
  const stream = new Readable()
  stream.push(text)
  stream.push(null)
  return stream
}

// 3. 加载第三方模块
app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/node_modules/.vite/')) {
    const moduleName = ctx.path.substring(20)
    const pkgPath = path.join(process.cwd(), 'node_modules', moduleName, 'package.json')
    const pkg = require(pkgPath)
    ctx.path = path.join('/node_modules', moduleName, pkg.module)
  }
  await next()
})

// 1. 开启静态文件服务器
app.use(async (ctx, next) => {
  await send(ctx, ctx.path, { root: process.cwd(), index: 'index.html' })
  await next()
})

// 4. 编译单文件组件
app.use(async (ctx, next) => {
  // 判断请求的是否为单文件组件 --> .vue 结尾
  if (ctx.path.endsWith('.vue')) {
    // 把 ctx.body 流转换为字符串
    const contents = await streamToString(ctx.body)
    // 调用 compilerSFC 的 parse 方法 编译单文件组件
    // 返回两个成员 descriptor单文件组件描述对象 errors编译过程中收集的错误
    const { descriptor } = compilerSFC.parse(contents)
    // 最终要返回给浏览器的代码 code
    let code
    // 第一次请求 返回选项对象 不带 type
    console.log(descriptor.script)
    console.log(contents)
    if (!ctx.query.type) {
      // 单文件组件编译后的js代码
      code = descriptor.script.content
      // console.log(code)
      // 把 code 的内容替换为 我们想要的 <export default > --> <const __script = >
      code = code.replace(/export\s+default\s+/g, 'const __script = ')
      code += `
        import { render as __render } from "${ctx.path}?type=template"
        __script.render = __render
        export default __script
        `
    } else if (ctx.query.type === 'template') {
      const templateRender = compilerSFC.compileTemplate({ source: descriptor.template })
      code = templateRender.code
    }
    // 设置响应头中的 Content-Type 为 application/javascript
    ctx.type = 'application/javascript'
    // 把 code 转换为只读流 输出给浏览器
    ctx.body = stringToStream(code)
  }
  await next()
})

// 2. 修改第三方模块的路径
app.use(async (ctx, next) => {
  if (ctx.type === 'application/javascript') {
    const contents = await streamToString(ctx.body)
    // import vue from 'vue'
    // import App from './App.vue'
    ctx.body = contents
    .replace(/(from\s+['"])(?!\.\/)/g, '$1/node_modules/.vite/')
    .replace(/process\.env\.NODE_ENV/g,'"development"')
  }
  await next()
})


app.listen(3001, () => console.log('Server running http://localhost:3001'))
