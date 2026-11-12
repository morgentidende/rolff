const esbuild=require('esbuild'),fs=require('node:fs'),path=require('node:path');
async function bundle(){return (await esbuild.build({entryPoints:[path.join(__dirname,'fixture.tsx')],bundle:true,write:false,format:'iife',jsx:'automatic',plugins:[{name:'no-network-push-fixture',setup(b){b.onResolve({filter:/^\.\/push$/},()=>({path:path.join(__dirname,'mock-push.ts')}));}}]})).outputFiles[0].text;}
async function build(out='/workspace/rolff-notifications-ui'){
 fs.mkdirSync(out,{recursive:true});const js=await bundle();fs.writeFileSync(path.join(out,'fixture.js'),js);fs.copyFileSync(path.join(__dirname,'../../src/styles.css'),path.join(out,'styles.css'));
 fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self';connect-src 'none';img-src 'none';style-src 'self' 'unsafe-inline';script-src 'self';worker-src 'none';object-src 'none';base-uri 'none';form-action 'none'"><link rel="stylesheet" href="styles.css"><title>Synthetic ROLFF notifications</title></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
 const css=fs.readFileSync(path.join(out,'styles.css'),'utf8');
 const inline=js.replace(/<\/script/gi,'<\\/script');
 fs.writeFileSync(path.join(out,'self-contained.html'),`<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';connect-src 'none';img-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline';worker-src 'none';object-src 'none';base-uri 'none';form-action 'none'"><style>${css}</style><title>Synthetic ROLFF notifications — self-contained</title></head><body><div id="root"></div><script>${inline}</script></body></html>`);
 console.log(out);
}
module.exports={bundle,build};if(require.main===module)build(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1;});
