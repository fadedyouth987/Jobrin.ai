import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { AppLink } from '../../app/router';

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  return <header className="public-header">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <div className="public-header-inner">
      <AppLink href="/" className="brand"><span className="brand-mark">J</span><span>Jobrin<span className="text-indigo-600">.ai</span></span></AppLink>
      <nav aria-label="Main navigation" className="public-desktop-nav">
        <a href="/#product">Product</a><a href="/#ai">AI receptionist</a><a href="/#security">Security</a><AppLink href="/pricing">Pricing</AppLink>
      </nav>
      <div className="public-header-actions"><AppLink href="/login" className="public-login">Log in</AppLink><AppLink href="/signup" className="public-start">Start free</AppLink><button type="button" className="public-menu" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="public-mobile-nav" onClick={() => setOpen(!open)}>{open ? <X size={20}/> : <Menu size={20}/>}</button></div>
    </div>
    {open && <nav id="public-mobile-nav" aria-label="Mobile navigation" className="public-mobile-nav" onClick={() => setOpen(false)}><a href="/#product">Product</a><a href="/#ai">AI receptionist</a><a href="/#security">Security</a><AppLink href="/pricing">Pricing</AppLink><AppLink href="/login">Log in</AppLink></nav>}
  </header>;
}
