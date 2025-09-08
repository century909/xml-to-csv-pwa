import React, { useState, useEffect } from 'react';
import { XMLParser } from 'fast-xml-parser';
import Papa from 'papaparse';
import { useGoogleLogin } from '@react-oauth/google';
import './App.css';

// Simple SVG Icons
const FileIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const GmailIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);

const CalendarIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const CompanyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
);

// Interfaces
interface InvoiceData {
  id: string;
  numeroFactura: string;
  fecha: string;
  monto: string;
  iva10: string;
  iva5: string;
  ivaTotal: string;
  ruc: string;
  nombre: string;
  timbrado: string;
}


// --- Componente Principal ---
function App() {
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");

  // --- Lógica de Parseo (reutilizable) ---
  const processXmlString = (xmlString: string, fileName: string): InvoiceData | null => {
    const options = { ignoreAttributes: false, attributeNamePrefix: "@_" };
    const parser = new XMLParser(options);
    try {
      const parsedXml = parser.parse(xmlString);
      const de = parsedXml?.['rDE']?.['DE'];
      const gTimb = de?.gTimb;
      const gDatGralOpe = de?.gDatGralOpe;
      const gTotSub = de?.gTotSub;

      if (!gTimb || !gDatGralOpe || !gTotSub) {
        console.warn(`Archivo ${fileName} no parece ser una factura válida.`);
        return null;
      }

      return {
        id: fileName + '-' + Math.random(),
        numeroFactura: `${gTimb?.dEst}-${gTimb?.dPunExp}-${gTimb?.dNumDoc}`,
        fecha: gDatGralOpe?.dFeEmiDE.split('T')[0],
        monto: parseFloat(gTotSub?.dTotGralOpe || '0').toFixed(2),
        iva10: parseFloat(gTotSub?.dIVA10 || '0').toFixed(2),
        iva5: parseFloat(gTotSub?.dIVA5 || '0').toFixed(2),
        ivaTotal: (parseFloat(gTotSub?.dIVA10 || '0') + parseFloat(gTotSub?.dIVA5 || '0')).toFixed(2),
        ruc: gDatGralOpe?.gEmis?.dRucEm,
        nombre: gDatGralOpe?.gEmis?.dNomEmi,
        timbrado: gTimb?.dNumTim,
      };
    } catch (err) {
      console.error(`Error parseando ${fileName}:`, err);
      return null;
    }
  };

  // --- Lógica de Gmail ---
  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setAccessToken(tokenResponse.access_token);
      await fetchGmailAttachments(tokenResponse.access_token, selectedMonth, companyName);
    },
    onError: () => {
      setStatusMessage('Error en el inicio de sesión con Google.');
      setIsError(true);
    },
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
  });

  useEffect(() => {
    if (accessToken) {
      fetchGmailAttachments(accessToken, selectedMonth, companyName);
    }
  }, [selectedMonth, accessToken, companyName]);

  const fetchGmailAttachments = async (token: string, month: string, company: string) => {
    setStatusMessage('Autenticado. Buscando facturas en Gmail...');
    setIsError(false);
    setIsLoading(true);
    setInvoices([]);

    try {
      // 1. Buscar IDs de correos con facturas XML
      const [year, monthNumber] = month.split('-');
      const startDate = `${year}-${monthNumber}-01`;
      const endDate = new Date(parseInt(year), parseInt(monthNumber), 0);
      const formattedEndDate = `${year}-${monthNumber}-${endDate.getDate()}`;
      
      let query = `has:attachment filename:xml after:${startDate} before:${formattedEndDate}`;
      if (company) {
        query += ` from:${company}`;
      }

      const listResponse = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!listResponse.ok) throw new Error('No se pudo listar los correos de Gmail.');
      const listData = await listResponse.json();

      if (!listData.messages || listData.resultSizeEstimate === 0) {
        setStatusMessage('No se encontraron correos con archivos adjuntos XML para el mes seleccionado.');
        setIsLoading(false);
        return;
      }

      setStatusMessage(`Se encontraron ${listData.messages.length} correos. Procesando adjuntos...`);

      // 2. Procesar cada correo para obtener los adjuntos
      const allInvoiceData: InvoiceData[] = [];
      for (const message of listData.messages.slice(0, 50)) { // Limitar a los primeros 50 correos para no exceder límites
        const msgResponse = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!msgResponse.ok) continue;
        const msgData = await msgResponse.json();
        const parts = msgData.payload.parts || [];

        for (const part of parts) {
          if (part.filename && part.filename.toLowerCase().endsWith('.xml') && part.body.attachmentId) {
            const attachResponse = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${message.id}/attachments/${part.body.attachmentId}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!attachResponse.ok) continue;
            const attachData = await attachResponse.json();
            
            // Decodificar Base64URL a string XML
            const xmlString = atob(attachData.data.replace(/-/g, '+').replace(/_/g, '/'));
            const invoice = processXmlString(xmlString, part.filename);
            if (invoice) allInvoiceData.push(invoice);
          }
        }
      }

      if (allInvoiceData.length > 0) {
        setInvoices(allInvoiceData);
        setStatusMessage(`Se procesaron ${allInvoiceData.length} facturas desde Gmail.`);
      } else {
        setStatusMessage('Se buscaron los correos pero no se encontraron facturas válidas en los adjuntos.');
        setIsError(true);
      }

    } catch (error) {
      console.error('Error al conectar con Gmail:', error);
      setStatusMessage('Ocurrió un error al procesar los archivos de Gmail.');
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Lógica de Archivos Locales ---
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      setStatusMessage('No se seleccionaron archivos.');
      setIsError(true);
      return;
    }

    setIsLoading(true);
    setInvoices([]);
    setStatusMessage(null);
    setIsError(false);
    const allInvoiceData: InvoiceData[] = [];

    for (const file of Array.from(files)) {
      const xmlString = await file.text();
      const invoice = processXmlString(xmlString, file.name);
      if (invoice) allInvoiceData.push(invoice);
    }

    if (allInvoiceData.length > 0) {
      setInvoices(allInvoiceData);
    } else {
      setStatusMessage('No se pudieron procesar los archivos o no contenían datos de factura válidos.');
      setIsError(true);
    }
    
    setIsLoading(false);
  };

  // --- Lógica de Exportación ---
  const downloadCSV = () => {
    if (invoices.length === 0) { alert('No hay datos para exportar.'); return; }
    const csv = Papa.unparse(invoices.map(item => ({
      'Fecha': item.fecha, 'Nº de Boleta': item.numeroFactura, 'Ruc': item.ruc,
      'Nombre': item.nombre, 'Monto': item.monto, 'Iva 10 %': item.iva10,
      'Iva 5%': item.iva5, 'Total Iva': item.ivaTotal, 'Timbrado': item.timbrado,
    })));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'facturas.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  // Custom loading component
  const LoadingSpinner = () => (
    <div className="spinner-container">
      <div className="spinner"></div>
      <p>Procesando facturas...</p>
    </div>
  );

  // --- Renderizado ---
  return (
    <div className="App">
      <header className="App-header">
        <h1>Visor y Exportador de Facturas XML</h1>
        <p>Cargue sus archivos de factura electrónica (.xml) o búsquelos en su Gmail.</p>
      </header>
      <main>
        <div className="actions">
          <div className="actions-grid">
            <label htmlFor="file-upload" className="button-grid button-upload">
              <FileIcon />
              <span>Cargar Archivos</span>
            </label>
            <input id="file-upload" type="file" accept=".xml,text/xml" multiple onChange={handleFileChange} />

            <button onClick={() => login()} className="button-grid button-gmail">
              <GmailIcon />
              <span>Buscar en Gmail</span>
            </button>

            <button 
              onClick={downloadCSV} 
              disabled={invoices.length === 0} 
              className="button-grid button-download"
            >
              <DownloadIcon />
              <span>Descargar CSV</span>
            </button>
          </div>

          <div className="filters">
            <div className="filter-item">
              <CalendarIcon />
              <input 
                type="month" 
                value={selectedMonth} 
                onChange={(e) => setSelectedMonth(e.target.value)} 
                className="month-selector" 
              />
            </div>
            <div className="filter-item">
              <CompanyIcon />
              <input 
                type="text" 
                value={companyName} 
                onChange={(e) => setCompanyName(e.target.value)} 
                placeholder="Filtrar por empresa" 
                className="company-selector" 
              />
            </div>
          </div>
        </div>

        {isLoading && <LoadingSpinner />}
        {statusMessage && (
          <div className={isError ? 'error-message' : 'status-message'}>
            {isError ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            )}
            <span>{statusMessage}</span>
          </div>
        )}

        {invoices.length > 0 && (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Factura</th>
                  <th>Fecha</th>
                  <th>RUC</th>
                  <th>Nombre</th>
                  <th className="text-right">Monto</th>
                  <th className="text-right">IVA 10%</th>
                  <th className="text-right">IVA 5%</th>
                  <th className="text-right">Total Iva</th>
                  <th>Timbrado</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(invoice => (
                  <tr key={invoice.id}>
                    <td>{invoice.numeroFactura}</td>
                    <td>{invoice.fecha}</td>
                    <td>{invoice.ruc}</td>
                    <td>{invoice.nombre}</td>
                    <td className="text-right">{invoice.monto}</td>
                    <td className="text-right">{invoice.iva10}</td>
                    <td className="text-right">{invoice.iva5}</td>
                    <td className="text-right">{invoice.ivaTotal}</td>
                    <td>{invoice.timbrado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
