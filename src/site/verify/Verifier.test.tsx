/// <reference types="vite/client" />
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Verifier } from './Verifier';

const FILES = import.meta.glob<string>('../fixtures/*', { query: '?raw', import: 'default', eager: true });
const fixture = (name: string, as: string = name) => new File([FILES[`../fixtures/${name}`] ?? ''], as);
const ED25519 = 'SHA256:AbRSJ30D/JQ5VqNHm1lI0tlzn8pp6lk26mOj2krpMpw';

function choose(files: File[]) {
  const input = document.querySelector('input[type=file]');
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
  fireEvent.change(input, { target: { files } });
}

describe('Verifier', () => {
  it('says nothing until it has a document and its signature, then gives a verdict', async () => {
    render(<Verifier />);
    choose([fixture('trusted.json', 'trusted.report.json')]);
    expect(screen.queryByRole('status')).toBeNull();
    choose([fixture('trusted.sig', 'trusted.report.json.sig')]);
    expect(await screen.findByText('The signature is good. Now check the key.')).toBeTruthy();
  });

  it('trusts the report once the agreed fingerprint is entered, and links into the recording only where it can', async () => {
    render(<Verifier />);
    fireEvent.change(screen.getByLabelText('The fingerprint in your agreement'), { target: { value: ED25519 } });
    choose([fixture('trusted.json', 'trusted.report.json'), fixture('trusted.sig', 'trusted.report.json.sig')]);
    expect(await screen.findByText("This report is the creator's, unchanged.")).toBeTruthy();
    expect(screen.getByText('What the airtime report says')).toBeTruthy();
    expect(screen.getAllByText('Passed:', { exact: false })).toHaveLength(3);
  });

  it('refuses a signature for another document', async () => {
    render(<Verifier />);
    choose([fixture('trusted.json', 'trusted.report.json'), fixture('ed25519.sig', 'other.report.json.sig')]);
    expect(await screen.findByText('Do not rely on this file.')).toBeTruthy();
  });
});
