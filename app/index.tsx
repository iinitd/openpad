import { Redirect } from "expo-router";

/**
 * The app opens straight into the writer. A first launch lands in the demo
 * workspace (seeded by the connection store), so there is no connection gate
 * in front of the product.
 */
export default function Index() {
  return <Redirect href="/writer/session" />;
}
