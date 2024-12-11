for dir in character-counter conditional-fields content-calendar dall-e disabled-field field-anchor-menu lorem-ipsum table-editor tag-editor unsplash web-previews yandex-translate; do
  pushd $dir
  npx json -I -f package.json -e "this.version = this.version.replace(/(\d+)$/, m => parseInt(m) + 1);"
  npm publish --otp=`bw get totp ce0989f6-7f58-4602-bd3b-ad0300a6e672`
  popd
done