'use client';
// PROTOTYPE — second route to test Next routing under each option
import { useEffect } from 'react';
import { report } from '../tiny';
export default function About() {
  useEffect(() => { report({ route: 'about', ok: true, href: location.href, errors: (window as any).__errs ?? [] }); }, []);
  return <main><h1>About route</h1></main>;
}
