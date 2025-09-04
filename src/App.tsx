import React, { useState, useEffect } from 'react';
import { XMLParser } from 'fast-xml-parser';
import Papa from 'papaparse';
import { useGoogleLogin } from '@react-oauth/google';
import './App.css';

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
  
  // --- Renderizado ---
  return (
    <div className="App">
      <header className="App-header">
        <h1>Visor y Exportador de Facturas XML</h1>
        <p>Cargue sus archivos de factura electrónica (.xml) o búsquelos en su Gmail.</p>
      </header>
      <main>
        <div className="actions">
          <label htmlFor="file-upload" className="button button-upload">Seleccionar Archivos Locales</label>
          <input id="file-upload" type="file" accept=".xml,text/xml" multiple onChange={handleFileChange} />
          <button onClick={() => login()} className="button button-gmail">Buscar en Gmail</button>
          <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="month-selector" />
          <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Filtrar por empresa" className="company-selector" />
          <button onClick={downloadCSV} disabled={invoices.length === 0} className="button button-download">Descargar CSV</button>
        </div>

        {isLoading && <div className="spinner"></div>}
        {statusMessage && <p className={isError ? 'error-message' : 'status-message'}>{statusMessage}</p>}

        {invoices.length > 0 && (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Factura</th><th>Fecha</th><th>RUC</th><th>Nombre</th><th>Monto</th>
                  <th>IVA 10%</th><th>IVA 5%</th><th>Total Iva</th><th>Timbrado</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(invoice => (
                  <tr key={invoice.id}>
                    <td>{invoice.numeroFactura}</td><td>{invoice.fecha}</td><td>{invoice.ruc}</td>
                    <td>{invoice.nombre}</td><td>{invoice.monto}</td><td className="text-right">{invoice.iva10}</td>
                    <td className="text-right">{invoice.iva5}</td><td className="text-right">{invoice.ivaTotal}</td>
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
