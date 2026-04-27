import React, { useState, useEffect } from 'react';
import { Clapperboard, DollarSign, TrendingUp, Clock, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { collection, getDocs, query, limit, orderBy, where, or, updateDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError } from '../lib/firestoreUtils';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

// Cast Draggable to any to avoid strict type issues with React 19
const DraggableComponent = Draggable as any;
const DroppableComponent = Droppable as any;

export default function Dashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState([
    { label: 'Proyectos Activos', value: '0', icon: Clapperboard, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Presupuesto Total', value: '$0M', icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50' },
  ]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const PROJECT_STATUSES = ['Presupuesto', 'Pre Producción', 'Rodaje', 'Post', 'Aprobado'];

  useEffect(() => {
    if (!profile) return;

    const fetchDashboardData = async () => {
      try {
        const pq = profile.role === 'admin'
          ? query(collection(db, 'projects'), orderBy('createdAt', 'desc'))
          : query(
              collection(db, 'projects'),
              or(
                where('createdBy', '==', profile.uid),
                where('collaboratorEmails', 'array-contains', profile.email)
              ),
              orderBy('createdAt', 'desc')
            );
        const pSnap = await getDocs(pq);
        const projectsData = pSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
        setProjects(projectsData);
        
        const totalBudget = projectsData.reduce((acc, curr) => acc + (Number(curr.budgetTotal) || 0), 0);

        setStats([
          { label: 'Proyectos Activos', value: projectsData.length.toString(), icon: Clapperboard, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Presupuesto Total', value: `$${(totalBudget / 1000000).toFixed(1)}M`, icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50' },
        ]);

      } catch (error: any) {
        console.error("Error fetching dashboard data:", error);
        if (error.message?.includes('insufficient permissions')) {
          handleFirestoreError(error, 'list', 'projects');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [profile]);

  const onDragEnd = async (result: any) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    const newStatus = destination.droppableId;
    const projectToUpdate = projects.find(p => p.id === draggableId);

    if (!projectToUpdate) return;

    // Optimistically update UI
    const updatedProjects = projects.map(p => 
      p.id === draggableId ? { ...p, status: newStatus } : p
    );
    setProjects(updatedProjects);

    try {
      const projectRef = doc(db, 'projects', draggableId);
      await updateDoc(projectRef, { 
        status: newStatus,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error("Error updating project status:", error);
      // Revert if error
      setProjects(projects);
    }
  };

  const getProjectsByStatus = (status: string) => {
    return projects.filter(p => p.status === status);
  };

  const statusColors: Record<string, string> = {
    'Presupuesto': 'border-slate-200 bg-slate-50',
    'Pre Producción': 'border-blue-100 bg-blue-50/30',
    'Rodaje': 'border-rose-100 bg-rose-50/30',
    'Post': 'border-purple-100 bg-purple-50/30',
    'Aprobado': 'border-emerald-100 bg-emerald-50/30',
  };

  return (
    <div className="max-w-full mx-auto space-y-4">
      <header>
        <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-0.5">Global / En curso</div>
        <h1 className="text-xl font-light text-slate-900 leading-none">Pipeline: <span className="font-bold text-black">Estado de Producciones</span></h1>
      </header>

      <div className="flex gap-3 max-w-md">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="flex-1 bg-white p-3 rounded-lg border border-slate-200 shadow-sm"
          >
            <div className="text-[9px] text-slate-400 font-bold uppercase mb-1 tracking-wider">{stat.label}</div>
            <div className="flex items-center justify-between">
                <div className="text-lg font-bold text-slate-900 leading-none">{stat.value}</div>
                <stat.icon className={cn("w-4 h-4", stat.color)} />
            </div>
          </motion.div>
        ))}
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-5 gap-2 min-h-[calc(100vh-220px)] items-start">
          {PROJECT_STATUSES.map((status, i) => {
              const columnProjects = getProjectsByStatus(status);
              const columnBudget = columnProjects.reduce((sum, p) => sum + (Number(p.budgetTotal) || 0), 0);
              
              return (
                  <motion.div 
                      key={status} 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="flex flex-col gap-2 min-w-0 h-full"
                  >
                      <div className={cn(
                          "p-2.5 rounded-lg border flex flex-col gap-0.5 shadow-sm",
                          statusColors[status] || 'border-slate-100 bg-slate-50'
                      )}>
                          <div className="flex justify-between items-center">
                              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-900 truncate mr-1">{status}</h3>
                              <span className="text-[9px] font-bold bg-white/50 px-1.5 py-0.5 rounded-full border border-black/5 leading-none">{columnProjects.length}</span>
                          </div>
                          <div className="text-sm font-bold text-slate-900 leading-none">
                              ${(columnBudget / 1000000).toFixed(1)}M
                          </div>
                      </div>

                      <DroppableComponent droppableId={status}>
                        {(provided: any, snapshot: any) => (
                          <div 
                              {...provided.droppableProps}
                              ref={provided.innerRef}
                              className={cn(
                                "flex-1 flex flex-col gap-2 rounded-lg transition-colors p-1",
                                snapshot.isDraggingOver ? "bg-slate-50/50" : ""
                              )}
                          >
                              {columnProjects.length > 0 ? (
                                  columnProjects.map((project, index) => (
                                    <DraggableComponent key={project.id} draggableId={project.id} index={index}>
                                      {(provided: any, snapshot: any) => (
                                        <div
                                          ref={provided.innerRef}
                                          {...provided.draggableProps}
                                          {...provided.dragHandleProps}
                                          className={cn(
                                            "bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm transition-all group relative",
                                            snapshot.isDragging ? "shadow-lg border-black z-50 scale-105" : "hover:border-black"
                                          )}
                                        >
                                          <Link 
                                              to={`/proyectos/${project.id}`}
                                              className="block"
                                              onClick={(e) => {
                                                if (snapshot.isDragging) e.preventDefault();
                                              }}
                                          >
                                              <div className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-1 truncate group-hover:text-black">
                                                  {project.clientName || 'Sin Cliente'}
                                              </div>
                                              <h4 className="text-xs font-bold text-slate-900 mb-2 leading-tight line-clamp-2 min-h-[2rem] group-hover:underline">
                                                  {project.name}
                                              </h4>
                                              <div className="flex justify-between items-center pt-2 border-t border-slate-50">
                                                  <div className="text-[9px] font-bold text-slate-900">
                                                      ${(Number(project.budgetTotal) / 1000).toFixed(1)}k
                                                  </div>
                                                  <div className="w-5 h-5 bg-slate-50 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-300">
                                                      {project.name[0]}
                                                  </div>
                                              </div>
                                          </Link>
                                        </div>
                                      )}
                                    </DraggableComponent>
                                  ))
                              ) : (
                                  <div className="flex-1 border border-dashed border-slate-100 rounded-lg flex items-center justify-center p-4">
                                      <p className="text-[8px] font-bold uppercase tracking-widest text-slate-200">Vacío</p>
                                  </div>
                              )}
                              {provided.placeholder}
                          </div>
                        )}
                      </DroppableComponent>
                  </motion.div>
              );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
