import { getCategories } from '@/lib/db';
import NavbarInner from './NavbarInner';

/** Server wrapper — fetches the live category list and hands it to the interactive navbar. */
export default async function Navbar() {
  let categories: Awaited<ReturnType<typeof getCategories>> = [];
  try {
    categories = await getCategories();
  } catch {
    /* navbar still renders without categories */
  }
  return <NavbarInner categories={categories} />;
}
