rm -rf node_modules .gitignore react-app-env.d.ts src/react-app-env.d.ts tsconfig.json package-lock.json extra
rm public/index.html

mv src/index.tsx src/main.tsx

wget https://raw.githubusercontent.com/datocms/datocms-plugin-template/refs/heads/main/src/vite-env.d.ts -P src

wget https://raw.githubusercontent.com/datocms/datocms-plugin-template/refs/heads/main/index.html
wget https://raw.githubusercontent.com/datocms/datocms-plugin-template/refs/heads/main/.gitignore

wget https://raw.githubusercontent.com/datocms/datocms-plugin-template/refs/heads/main/tsconfig.app.json
wget https://raw.githubusercontent.com/datocms/datocms-plugin-template/refs/heads/main/tsconfig.json
wget https://raw.githubusercontent.com/datocms/datocms-plugin-template/refs/heads/main/tsconfig.node.json
wget https://raw.githubusercontent.com/datocms/datocms-plugin-template/refs/heads/main/vite.config.ts

npx json -I -f package.json -e "delete this.scripts.test; delete this.scripts.eject; delete this.scripts.start; this.scripts.dev='vite'; this.scripts.build='tsc -b && vite build'; this.scripts.preview='vite preview';"
npx json -I -f package.json -e "if (this.files) { this.files = this.files.map(x => x === 'build' ? 'dist' : x); } else { this.files = ['dist', 'docs'] }"
npx json -I -f package.json -e "for (const pkg of ['@types/node', 'react-scripts', 'typescript']) { delete this.dependencies[pkg]; delete this.devDependencies[pkg]; }"
npx json -I -f package.json -e "this.devDependencies['@vitejs/plugin-react'] = '^4.3.1'; this.devDependencies['globals'] = '^15.9.0'; this.devDependencies['typescript'] = '^5.5.3'; this.devDependencies['vite'] = '^5.4.1';"
npx json -I -f package.json -e "this.datoCmsPlugin.entryPoint = 'dist/index.html';"
npx json -I -f package.json -e "delete this.eslintConfig; delete this.browserslist"
npx json -I -f package.json -e "this.version = this.version.replace(/(\d+)$/, m => parseInt(m) + 1); this.type = 'module';"

npm i
npm run build
