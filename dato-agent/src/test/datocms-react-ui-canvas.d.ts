// The tests provide the kit's plugin ctx directly. The package ships the types of
// this deep path separately, under dist/types.
declare module 'datocms-react-ui/dist/cjs/Canvas' {
  export { CtxContext } from 'datocms-react-ui/dist/types/Canvas';
}
