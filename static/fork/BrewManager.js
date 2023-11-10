const join = require('path').join
const { spawn, execSync } = require('child_process')
const { exec } = require('child-process-promise')
const Utils = require('./Utils.js')
const BaseManager = require('./BaseManager')
const { existsSync, unlinkSync } = require('fs')
const { I18nT } = require('./lang/index.js')
class BrewManager extends BaseManager {
  constructor() {
    super()
  }

  async installBrew() {
    if (!global.Server.BrewCellar) {
      Utils.execAsync('which', ['brew'])
        .then(() => {
          Utils.execAsync('brew', ['--repo'])
            .then((p) => {
              global.Server.BrewHome = p
              Utils.execAsync('git', [
                'config',
                '--global',
                '--add',
                'safe.directory',
                join(p, 'Library/Taps/homebrew/homebrew-core')
              ]).then()
              Utils.execAsync('git', [
                'config',
                '--global',
                '--add',
                'safe.directory',
                join(p, 'Library/Taps/homebrew/homebrew-cask')
              ]).then()
              return Utils.execAsync('brew', ['--cellar'])
            })
            .then((c) => {
              console.log('brew --cellar: ', c)
              global.Server.BrewCellar = c
              process.send({
                command: 'application:global-server-updata',
                key: 'application:global-server-updata',
                info: global.Server
              })
              this._processSend({
                code: 0,
                msg: 'SUCCESS',
                data: global.Server
              })
            })
        })
        .catch(() => {
          this._processSend({
            code: 1,
            msg: I18nT('fork.brewNoFound')
          })
        })
    } else {
      process.send({
        command: 'application:global-server-updata',
        key: 'application:global-server-updata',
        info: global.Server
      })
      this._processSend({
        code: 0,
        msg: 'SUCCESS',
        data: global.Server
      })
    }
  }

  _doInstallOrUnInstall(rb, action) {
    return new Promise((resolve, reject) => {
      const opt = this._fixEnv()
      const arch = global.Server.isAppleSilicon ? '-arm64' : '-x86_64'
      const name = rb
      const sh = join(global.Server.Static, 'sh/brew-cmd.sh')
      const copyfile = join(global.Server.Cache, 'brew-cmd.sh')
      if (existsSync(copyfile)) {
        unlinkSync(copyfile)
      }
      Utils.readFileAsync(sh)
        .then((content) => {
          return Utils.writeFileAsync(copyfile, content)
        })
        .then(() => {
          Utils.chmod(copyfile, '0777')
          const child = spawn('bash', [copyfile, arch, action, name], opt)
          this._childHandle(child, resolve, reject)
        })
    })
  }

  install(name) {
    this._doInstallOrUnInstall(name, 'install').then(this._thenSuccess).catch(this._catchError)
  }

  uninstall(name) {
    this._doInstallOrUnInstall(name, 'uninstall').then(this._thenSuccess).catch(this._catchError)
  }

  brewinfo(name) {
    const Info = {}
    const findAll = () => {
      const all = []
      let cammand = ''
      switch (name) {
        case 'php':
          all.push('php')
          cammand = 'brew search --formula "/php@[\\d\\.]+$/"'
          break
        case 'nginx':
          all.push('nginx')
          break
        case 'apache':
          all.push('httpd')
          break
        case 'memcached':
          all.push('memcached')
          break
        case 'mysql':
          all.push('mysql')
          cammand = 'brew search --formula "/mysql@[\\d\\.]+$/"'
          break
        case 'mariadb':
          all.push('mariadb')
          cammand = 'brew search --formula "/mariadb@[\\d\\.]+$/"'
          break
        case 'redis':
          all.push('redis')
          cammand = 'brew search --formula "/redis@[\\d\\.]+$/"'
          break
        case 'mongodb':
          cammand =
            'brew search --desc --eval-all --formula "High-performance, schema-free, document-oriented database"'
          break
      }
      if (cammand) {
        try {
          let content = execSync(cammand, {
            env: {
              HOMEBREW_NO_INSTALL_FROM_API: 1,
              ...Utils.fixEnv()
            }
          }).toString()
          if (name === 'mongodb') {
            content = content
              .replace('==> Formulae', '')
              .replace(
                new RegExp(
                  ': High-performance, schema-free, document-oriented database \\(Enterprise\\)',
                  'g'
                ),
                ''
              )
              .replace(
                new RegExp(': High-performance, schema-free, document-oriented database', 'g'),
                ''
              )
          }
          content = content
            .split('\n')
            .filter((s) => !!s.trim())
            .map((s) => s.trim())
          all.push(...content)
        } catch (e) {}
      }
      return all
    }
    const doRun = () => {
      const all = findAll()
      const cammand = ['brew', 'info', ...all, '--json', '--formula'].join(' ')
      try {
        const info = execSync(cammand, {
          env: {
            HOMEBREW_NO_INSTALL_FROM_API: 1,
            ...Utils.fixEnv()
          }
        }).toString()
        const arr = JSON.parse(info)
        arr.forEach((item) => {
          Info[item.full_name] = {
            version: item?.versions?.stable ?? '',
            installed: item?.installed?.length > 0,
            name: item.full_name,
            flag: 'brew'
          }
        })
      } catch (e) {}
      this._processSend({
        code: 0,
        msg: 'SUCCESS',
        data: Info
      })
    }
    doRun()
  }

  portinfo(flag) {
    const Info = {}
    let reg = `^${flag}\\d*$`
    if (flag === 'mariadb') {
      reg = '^mariadb-([\\d\\.]*)\\d$'
    }
    Utils.execAsync('port', ['search', '--name', '--line', '--regex', reg])
      .then((info) => {
        console.log('portinfo: ', info)
        info = info ?? ''
        let arr = []
        try {
          arr = info
            .split('\n')
            .filter((f) => {
              if (flag === 'php') {
                return f.includes('lang www') && f.includes('PHP: Hypertext Preprocessor')
              }
              if (flag === 'nginx') {
                return f.includes('High-performance HTTP(S) server')
              }
              if (flag === 'apache') {
                return f.includes('The extremely popular second version of the Apache http server')
              }
              if (flag === 'mysql') {
                return f.includes('Multithreaded SQL database server')
              }
              if (flag === 'mariadb') {
                return f.includes('Multithreaded SQL database server')
              }
              if (flag === 'memcached') {
                return f.includes('A high performance, distributed memory object caching system.')
              }
              if (flag === 'redis') {
                return f.includes('Redis is an open source, advanced key-value store.')
              }
              if (flag === 'mongodb') {
                return f.includes('high-performance, schema-free, document-oriented')
              }
              return true
            })
            .map((m) => {
              const a = m.split('\t').filter((f) => f.trim().length > 0)
              const name = a.shift()
              const version = a.shift()
              let installed = false
              if (flag === 'php') {
                installed = existsSync(join('/opt/local/bin/', name))
              } else if (flag === 'nginx') {
                installed = existsSync(join('/opt/local/sbin/', name))
              } else if (flag === 'apache') {
                installed = existsSync(join('/opt/local/sbin/', 'apachectl'))
              } else if (flag === 'mysql') {
                installed = existsSync(join('/opt/local/lib', name, 'bin/mysqld_safe'))
              } else if (flag === 'mariadb') {
                installed = existsSync(join('/opt/local/lib', name, 'bin/mariadbd-safe'))
              } else if (flag === 'memcached') {
                installed = existsSync(join('/opt/local/bin', name))
              } else if (flag === 'redis') {
                installed = existsSync(join('/opt/local/bin', `${name}-server`))
              } else if (flag === 'mongodb') {
                installed =
                  existsSync(join('/opt/local/bin', 'mongod')) ||
                  existsSync(join('/opt/local/sbin', 'mongod'))
              }
              return {
                name,
                version,
                installed,
                flag: 'port'
              }
            })
        } catch (e) {}
        arr.forEach((item) => {
          Info[item.name] = item
        })
        this._processSend({
          code: 0,
          msg: 'SUCCESS',
          data: Info
        })
      })
      .catch((err) => {
        this._processSend({
          code: 1,
          msg: err.toString()
        })
      })
  }

  addTap(name) {
    Utils.execAsync('brew', ['tap'])
      .then((stdout) => {
        if (stdout.includes(name)) {
          return null
        } else {
          return Utils.execAsync('brew', ['tap', name])
        }
      })
      .then(() => {
        this._processSend({
          code: 0,
          msg: `Brew install tap ${name} SUCCESS`
        })
      })
      .catch((err) => {
        this._processSend({
          code: 1,
          msg: err.toString()
        })
      })
  }

  currentSrc() {
    Utils.execAsync('git', ['remote', '-v'], {
      cwd: global.Server.BrewHome
    })
      .then((src) => {
        let value = 'default'
        if (src.includes('tsinghua.edu.cn')) {
          value = 'tsinghua'
        } else if (src.includes('bfsu.edu.cn')) {
          value = 'bfsu'
        } else if (src.includes('cloud.tencent.com')) {
          value = 'tencent'
        } else if (src.includes('aliyun.com')) {
          value = 'aliyun'
        } else if (src.includes('ustc.edu.cn')) {
          value = 'ustc'
        }
        this._processSend({
          code: 0,
          msg: 'SUCCESS',
          data: value
        })
      })
      .catch((err) => {
        console.log('brew currentSrc err: ', err)
        this._processSend({
          code: 1,
          msg: err.toString()
        })
      })
  }

  changeSrc(srcFlag) {
    const sh = join(global.Server.Static, 'sh/brew-src.sh')
    const copyfile = join(global.Server.Cache, 'brew-src.sh')
    if (existsSync(copyfile)) {
      unlinkSync(copyfile)
    }
    Utils.readFileAsync(sh)
      .then((content) => {
        return Utils.writeFileAsync(copyfile, content)
      })
      .then(() => {
        Utils.chmod(copyfile, '0777')
        return exec(`source brew-src.sh ${srcFlag} ${global.Server.BrewHome}`, {
          env: Utils.fixEnv(),
          cwd: global.Server.Cache
        })
      })
      .then(() => {
        this._processSend({
          code: 0,
          msg: 'SUCCESS'
        })
      })
      .catch((err) => {
        console.log('brew changeSrc err: ', err)
        this._processSend({
          code: 1,
          msg: err.toString()
        })
      })
  }
}
module.exports = BrewManager
