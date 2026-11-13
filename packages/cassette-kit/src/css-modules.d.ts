/** CSS modules, as the host app's bundler (Next) compiles them: a map of class names. */
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
