import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Earlier · Cancellation recovery',description:'Fictional clinic scheduling demo'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
